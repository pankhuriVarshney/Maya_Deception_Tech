// Decoy Lifecycle Manager -- Epic 1 minimum viable version.
//
// Scope, deliberately kept small: provision, terminate, scale a decoy
// Deployment by type. NOT in scope yet:
//   - RL-driven tier selection (Epic 7 calls into ProvisionDecoy later)
//   - breadcrumb-trigger-driven provisioning (Epic 9)
//   - auth on these endpoints (Epic 5 puts this behind mTLS/JWT/RBAC
//     and moves it into the maya-control namespace)
//
// This is intentionally an internal-only service. Do not expose outside
// the cluster until Epic 5 lands.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

const decoyNamespace = "maya-decoys"

// knownDecoyTypes maps a decoy "type" name to its Deployment name in-cluster.
// Add an entry here each time a new decoy image/manifest is added under k8s/decoy/.
var knownDecoyTypes = map[string]string{
	"web":   "fake-web-03",
	"redis": "fake-redis-01",
	"jump":  "fake-jump-01",
}

type clientCtx struct {
	clientset *kubernetes.Clientset
}

type provisionRequest struct {
	Type string `json:"type"`
}

type scaleRequest struct {
	Type     string `json:"type"`
	Replicas int32  `json:"replicas"`
}

func (c *clientCtx) handleProvision(w http.ResponseWriter, r *http.Request) {
	var req provisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	deployName, ok := knownDecoyTypes[req.Type]
	if !ok {
		http.Error(w, fmt.Sprintf("unknown decoy type: %s", req.Type), http.StatusBadRequest)
		return
	}

	// Provisioning here means "ensure replicas >= 1". Actual pod creation
	// happens via the Deployment already applied from k8s/decoy/<type>/.
	err := c.setReplicas(r.Context(), deployName, 1)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status":     "provisioned",
		"deployment": deployName,
	})
}

func (c *clientCtx) handleTerminate(w http.ResponseWriter, r *http.Request) {
	var req provisionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	deployName, ok := knownDecoyTypes[req.Type]
	if !ok {
		http.Error(w, fmt.Sprintf("unknown decoy type: %s", req.Type), http.StatusBadRequest)
		return
	}

	// Scale to zero rather than deleting the Deployment -- keeps the spec
	// (image, env, volumes) intact for fast re-provisioning, and matches
	// the "wipe and redeploy to reset compromised state" requirement:
	// scaling back to 1 afterward gives a fresh pod with clean state
	// (emptyDir syscache, no attacker-modified filesystem).
	err := c.setReplicas(r.Context(), deployName, 0)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status":     "terminated",
		"deployment": deployName,
	})
}

func (c *clientCtx) handleScale(w http.ResponseWriter, r *http.Request) {
	var req scaleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	deployName, ok := knownDecoyTypes[req.Type]
	if !ok {
		http.Error(w, fmt.Sprintf("unknown decoy type: %s", req.Type), http.StatusBadRequest)
		return
	}

	err := c.setReplicas(r.Context(), deployName, req.Replicas)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(map[string]string{
		"status":     "scaled",
		"deployment": deployName,
		"replicas":   fmt.Sprintf("%d", req.Replicas),
	})
}

func (c *clientCtx) setReplicas(ctx context.Context, deployName string, replicas int32) error {
	deploy, err := c.clientset.AppsV1().Deployments(decoyNamespace).Get(ctx, deployName, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("get deployment %s: %w", deployName, err)
	}

	deploy.Spec.Replicas = int32Ptr(replicas)

	_, err = c.clientset.AppsV1().Deployments(decoyNamespace).Update(ctx, deploy, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("update deployment %s: %w", deployName, err)
	}
	return nil
}

func int32Ptr(i int32) *int32 { return &i }

func newClientset() (*kubernetes.Clientset, error) {
	// In-cluster config when running as a pod; for local dev against
	// kind/minikube, wire up clientcmd.BuildConfigFromFlags("", kubeconfigPath)
	// here instead.
	config, err := rest.InClusterConfig()
	if err != nil {
		return nil, fmt.Errorf("not running in-cluster and no local kubeconfig loader wired up: %w; "+
			"for local dev add clientcmd.BuildConfigFromFlags(\"\", os.Getenv(\"KUBECONFIG\"))", err)
	}
	return kubernetes.NewForConfig(config)
}

func main() {
	clientset, err := newClientset()
	if err != nil {
		log.Fatalf("failed to build k8s client: %v", err)
	}

	c := &clientCtx{clientset: clientset}

	mux := http.NewServeMux()
	mux.HandleFunc("/provision", c.handleProvision)
	mux.HandleFunc("/terminate", c.handleTerminate)
	mux.HandleFunc("/scale", c.handleScale)

	addr := ":8081"
	log.Printf("decoy lifecycle manager listening on %s (namespace=%s)", addr, decoyNamespace)
	log.Fatal(http.ListenAndServe(addr, mux))
}

var _ = os.Getenv // keep os import if unused during early edits
