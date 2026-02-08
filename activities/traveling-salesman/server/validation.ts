import type { TravelingSalesmanCity } from '../travelingSalesmanTypes.js'

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const isRouteArray = (route: unknown): route is string[] =>
  Array.isArray(route) && route.every((id) => typeof id === 'string')

export const isCitiesArray = (cities: unknown): cities is TravelingSalesmanCity[] =>
  Array.isArray(cities) &&
  cities.every(
    (city) =>
      city &&
      typeof city.id === 'string' &&
      typeof city.name === 'string' &&
      isFiniteNumber(city.x) &&
      isFiniteNumber(city.y),
  )

export const isDistanceMatrix = (matrix: unknown, size?: number): matrix is number[][] => {
  if (!Array.isArray(matrix) || (typeof size === 'number' && matrix.length !== size)) return false
  return matrix.every(
    (row) =>
      Array.isArray(row) && (typeof size !== 'number' || row.length === size) && row.every((value) => isFiniteNumber(value)),
  )
}
