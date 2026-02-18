#!/bin/bash
# Debug script to check attacker data flow

echo "=== Maya Attacker Debug Script ==="
echo ""

echo "1. Checking MongoDB for attackers..."
echo "Query: http://localhost:3001/api/dashboard/debug/attackers"
echo ""
curl -s http://localhost:3001/api/dashboard/debug/attackers | jq '.data' 2>/dev/null || echo "Failed to query backend"

echo ""
echo "2. Checking active attackers endpoint..."
curl -s http://localhost:3001/api/dashboard/active-attackers | jq '.data | length' 2>/dev/null || echo "Failed"

echo ""
echo "3. Check backend logs for these messages:"
echo "   - 'Processing CRDT state from...'"
echo "   - 'Created new attacker: APT-...'"
echo "   - 'Updated attacker: APT-...'"
echo ""
echo "4. Check VM CRDT state manually:"
echo "   ./scripts/manage-vms.sh ssh fake-jump-01"
echo "   sudo cat /var/lib/.syscache"
echo ""
echo "5. Trigger manual CRDT sync:"
echo "   Backend polls every 10 seconds automatically"
echo "   Or check logs for 'Sync complete' messages"
