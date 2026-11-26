export type LocalizedCatalog<T> = {
  [K in keyof T]: T[K] extends string ? string : LocalizedCatalog<T[K]>;
};
