# Purpose: 
Track event ordering across distributed nodes

# Structure:
  counter: u64    -- Monotonic increment
  node_id: String -- Unique node identifier

# How it works:
  Local event:  counter += 1
  Remote merge: counter = max(local, remote)
  
# Result: 
If event A happened before B, A's counter < B's counter
(Partial ordering: concurrent events may have equal counters)