// generator/vagrant.go
package generator

import (
	"bytes"
	"embed"
	"fmt"
	"text/template"
	"time"
)

//go:embed templates/*.tmpl
var templateFS embed.FS

type HoneypotConfig struct {Fixed the frontend WebSocket URL builders in:

- [use-shared-websocket.ts](/home/karan/Maya_Deception_Tech/frontend/hooks/use-shared-websocket.ts:33)
- [use-websocket.ts](/home/karan/Maya_Deception_Tech/frontend/hooks/use-websocket.ts:10)

They now build from `window.location`, producing `ws://localhost:3000/ws` or `wss://.../ws` in the browser, so the Next.js `/ws` rewrite can proxy to `backend:3001`.

I only changed those WebSocket hook files. No tests were run; I verified with `rg` that the frontend hooks no longer build WebSocket URLs from `NEXT_PUBLIC_API_URL`.
	Name              string
	OS                string
	VagrantBox        string
	Services          []string
	NetworkTier       string
	MemoryMB          int
	CPUCores          int
	DiskGB            int
	DecoyDataProfile  string
	IP                string
	Peers             []string
}

type Generator struct {
	tmpl *template.Template
}

func New() (*Generator, error) {
	tmpl, err := template.ParseFS(templateFS, "templates/*.tmpl")
	if err != nil {
		return nil, fmt.Errorf("parse templates: %w", err)
	}

	// Add template functions
	tmpl = tmpl.Funcs(template.FuncMap{
		"now": time.Now,
		"join": func(sep string, items []string) string {
			return strings.Join(items, sep)
		},
	})

	return &Generator{tmpl: tmpl}, nil
}

func (g *Generator) GenerateVagrantfile(configs []HoneypotConfig, topology *Topology) (string, error) {
	data := struct {
		Configs   []HoneypotConfig
		Topology  *Topology
		Timestamp time.Time
	}{
		Configs:   configs,
		Topology:  topology,
		Timestamp: time.Now(),
	}

	var buf bytes.Buffer
	if err := g.tmpl.ExecuteTemplate(&buf, "Vagrantfile.tmpl", data); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}