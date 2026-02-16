Use case: Single value that changes over time (attacker location)

Rules:
  1. Higher timestamp wins
  2. If timestamps equal: higher node_id wins (deterministic tiebreaker)

Example:
  Alice: location="jump-01", ts=1000
  Bob:   location="web-02", ts=2000  ← Wins (newer)
  
  Merge result: location="web-02"