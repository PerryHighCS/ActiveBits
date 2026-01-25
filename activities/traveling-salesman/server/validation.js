export const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export const isRouteArray = (route) => Array.isArray(route) && route.every(id => typeof id === 'string');

export const isCitiesArray = (cities) => Array.isArray(cities) && cities.every(city => (
  city
  && typeof city.id === 'string'
  && typeof city.name === 'string'
  && isFiniteNumber(city.x)
  && isFiniteNumber(city.y)
));

export const isDistanceMatrix = (matrix, size) => {
  if (!Array.isArray(matrix) || (typeof size === 'number' && matrix.length !== size)) return false;
  return matrix.every(row =>
    Array.isArray(row)
    && (typeof size !== 'number' || row.length === size)
    && row.every(value => isFiniteNumber(value))
  );
};
