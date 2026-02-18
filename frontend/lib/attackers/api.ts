import type { AttackerDetails, AttackerSummary } from "@/types"

/**
 * Fetch attacker details from the real API
 * This replaces the mock data with live data from MongoDB
 */
export async function getAttackerDetailsFromApi(attackerId: string): Promise<AttackerDetails | null> {
  try {
    const res = await fetch(`/api/dashboard/attacker/${encodeURIComponent(attackerId)}`, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`HTTP ${res.status}`)
    }

    const json = await res.json() as { success: boolean; data: AttackerDetails; timestamp: string }
    
    if (!json.success || !json.data) {
      return null
    }

    return json.data
  } catch (error) {
    console.error('Failed to fetch attacker details:', error)
    return null
  }
}

/**
 * Fetch all active attackers from the real API
 */
export async function getActiveAttackersFromApi(): Promise<AttackerSummary[]> {
  try {
    const res = await fetch('/api/dashboard/active-attackers', {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      }
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`)
    }

    const json = await res.json() as { success: boolean; data: AttackerSummary[] }
    
    if (!json.success) {
      return []
    }

    return json.data
  } catch (error) {
    console.error('Failed to fetch active attackers:', error)
    return []
  }
}

/**
 * Format attacker ID for display
 * e.g., "APT-10-20-20-100" -> "APT-10.20.20.100"
 */
export function formatAttackerId(attackerId: string): string {
  // Convert APT-10-20-20-100 to APT-10.20.20.100 for display
  const parts = attackerId.split('-')
  if (parts.length > 1 && parts.slice(1).every(p => /^\d+$/.test(p))) {
    return `${parts[0]}-${parts.slice(1).join('.')}`
  }
  return attackerId
}

/**
 * Parse attacker ID to get IP address
 * e.g., "APT-10-20-20-100" -> "10.20.20.100"
 */
export function parseAttackerIp(attackerId: string): string {
  const parts = attackerId.split('-')
  if (parts.length > 1 && parts[0] === 'APT') {
    return parts.slice(1).join('.')
  }
  return attackerId
}
