Use case: History that never disappears (visited hosts)

Operations:
  add(x):     Insert x (never fails, never removes)
  merge(a,b): Union of both sets

Properties:
  - Monotonic: only grows
  - Idempotent: adding same element twice = once
  - Commutative: merge(a,b) = merge(b,a)

Example:
  Alice visited: {jump-01, web-02}
  Bob visited:   {web-02, db-01}
  
  Merge: {jump-01, web-02, db-01}