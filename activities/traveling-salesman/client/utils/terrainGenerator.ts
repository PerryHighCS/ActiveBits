import { seededRandom } from './cityGenerator'
import type { TerrainElement } from './tspUtilsTypes'

/**
 * Generate terrain pattern elements using seeded random
 * Old-west themed: dust, mesas, ridges, cactus, and wagon trails
 */
export function generateTerrainPattern(seed: number): TerrainElement[] {
  const random = seededRandom(seed + 12345) // Offset seed for different pattern
  const elements: TerrainElement[] = []

  const dustCount = 24 + Math.floor(random() * 12)
  for (let i = 0; i < dustCount; i++) {
    elements.push({
      type: 'dust',
      x: random() * 100,
      y: random() * 100,
      r: 1 + random() * 3,
      opacity: 0.15 + random() * 0.2,
    })
  }

  const mesaCount = 5 + Math.floor(random() * 4)
  for (let i = 0; i < mesaCount; i++) {
    elements.push({
      type: 'mesa',
      x: random() * 100,
      y: random() * 100,
      r: 6 + random() * 8,
      opacity: 0.18 + random() * 0.15,
    })
  }

  const ridgeCount = 6 + Math.floor(random() * 6)
  for (let i = 0; i < ridgeCount; i++) {
    const x1 = random() * 100
    const y1 = random() * 100
    const x2 = x1 + (random() * 18 - 9)
    const y2 = y1 + (random() * 12 - 6)
    elements.push({
      type: 'ridge',
      x1,
      y1,
      x2,
      y2,
      opacity: 0.25 + random() * 0.2,
    })
  }

  const cactusCount = 6 + Math.floor(random() * 6)
  for (let i = 0; i < cactusCount; i++) {
    elements.push({
      type: 'cactus',
      x: random() * 100,
      y: random() * 100,
      size: 2 + random() * 2,
      opacity: 0.6 + random() * 0.2,
    })
  }

  const trailCount = 4 + Math.floor(random() * 3)
  for (let i = 0; i < trailCount; i++) {
    const points: Array<[number, number]> = []
    let x = random() * 100
    let y = random() * 100
    points.push([x, y])
    for (let j = 0; j < 3; j++) {
      x += random() * 20 - 10
      y += random() * 12 - 6
      points.push([x, y])
    }
    elements.push({
      type: 'trail',
      points,
      opacity: 0.35 + random() * 0.2,
    })
  }

  const washCount = 2 + Math.floor(random() * 3)
  for (let i = 0; i < washCount; i++) {
    const points: Array<[number, number]> = []
    let x = random() * 100
    let y = random() * 100
    const baseAngle = random() * Math.PI * 2
    points.push([x, y])
    for (let j = 0; j < 4; j++) {
      const drift = (random() - 0.5) * 1.0
      const angle = baseAngle + drift
      const length = 12 + random() * 10
      x += Math.cos(angle) * length
      y += Math.sin(angle) * length
      points.push([x, y])
    }
    elements.push({
      type: 'wash',
      points,
      opacity: 0.35 + random() * 0.2,
    })
  }

  return elements
}
