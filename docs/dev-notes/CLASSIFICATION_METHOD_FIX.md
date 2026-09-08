# Classification Method Enum Fix

## Error

```
AttackEvent validation failed: classificationMethod: `fallback` is not a valid enum value for path `classificationMethod`.

Valid enum values: ["exact", "fuzzy", "pattern", "manual", "unknown"]
```

## Root Cause

The `getDefaultClassification()` function in `MitreAttackService.ts` was returning `method: 'fallback'`, but this value doesn't exist in the AttackEvent schema's enum.

### Schema Definition (AttackEvent.ts)

```typescript
classificationMethod: {
  type: String,
  enum: ['exact', 'fuzzy', 'pattern', 'manual', 'unknown'],  // ← 'fallback' not included
  default: 'unknown'
}
```

## Fix Applied

### 1. MitreAttackService.ts

**Changed:** Default classification method

```typescript
// BEFORE
function getDefaultClassification(): ClassifiedEvent {
  return {
    // ...
    method: 'fallback',  // ❌ Invalid enum value
    // ...
  };
}

// AFTER
function getDefaultClassification(): ClassifiedEvent {
  return {
    // ...
    method: 'unknown',  // ✅ Valid enum value
    // ...
  };
}
```

### 2. CRDTSyncService.ts

**Changed:** Handle legacy 'fallback' value during event creation

```typescript
// BEFORE
classificationMethod: classification?.method || 'pattern'

// AFTER
classificationMethod: classification?.method === 'fallback' ? 'unknown' : (classification?.method || 'pattern')
```

This ensures backward compatibility if any old code still returns 'fallback'.

## Why 'unknown'?

The `'unknown'` method is the most appropriate for fallback classification because:

1. **Semantically correct** - We don't know the classification method for unmatched commands
2. **Schema default** - The schema uses `'unknown'` as the default value
3. **Low confidence** - Matches the low confidence score (0.3) of fallback classification
4. **Queryable** - Can easily query for events with uncertain classification:
   ```javascript
   AttackEvent.find({ classificationMethod: 'unknown', mitreConfidence: { $lt: 0.5 } })
   ```

## Testing

After the fix, the logs should show:

```
✅ Created action event: APT-192-20-100-100 -> /fake-smb-01: some action
```

Instead of:

```
❌ Failed to create action event: AttackEvent validation failed: classificationMethod...
```

## Files Modified

| File | Change |
|------|--------|
| `backend/src/services/MitreAttackService.ts` | Changed `method: 'fallback'` to `method: 'unknown'` |
| `backend/src/services/CRDTSyncService.ts` | Added fallback handling for legacy 'fallback' values |

## Related: Classification Method Enum Values

| Value | When Used |
|-------|-----------|
| `exact` | Exact command signature match (e.g., "mimikatz") |
| `fuzzy` | Fuzzy pattern match (e.g., regex patterns) |
| `pattern` | Pattern-based match from command signatures |
| `manual` | Manually classified event |
| `unknown` | Default/fallback classification, or method unclear |

## Verification

Check the backend logs after restarting:

```bash
# Restart backend
cd backend
npm run dev

# Watch for errors
tail -f backend/logs/combined.log | grep -i "error\|validation"

# Should NOT see:
# AttackEvent validation failed: classificationMethod

# Should see:
# Created action event: ...
# Created visit event: ...
```
