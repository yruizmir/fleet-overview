const suffixes: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
  Ki: 2 ** 10,
  Mi: 2 ** 20,
  Gi: 2 ** 30,
  Ti: 2 ** 40,
  Pi: 2 ** 50,
  Ei: 2 ** 60,
};

// Parses a Kubernetes resource quantity ("250m", "16Gi", "1e3") into a plain number.
export const parseQuantity = (quantity: string | undefined): number => {
  if (!quantity) {
    return 0;
  }

  const match = /^([+-]?[0-9.]+(?:[eE][+-]?[0-9]+)?)([a-zA-Z]*)$/.exec(quantity.trim());

  if (!match) {
    return 0;
  }

  const multiplier = suffixes[match[2]];

  return multiplier === undefined ? 0 : Number(match[1]) * multiplier;
};

const byteUnits = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export const formatBytes = (bytes: number): string => {
  let value = bytes;
  let unit = 0;

  while (Math.abs(value) >= 1024 && unit < byteUnits.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${value.toFixed(value >= 100 || unit === 0 ? 0 : 1)} ${byteUnits[unit]}`;
};

export const formatCores = (cores: number): string =>
  cores >= 10 ? cores.toFixed(0) : cores >= 1 ? cores.toFixed(1) : cores.toFixed(2);

export const formatCount = (count: number): string => String(Math.round(count));

export const percentOf = (part: number | undefined, whole: number): number | undefined =>
  part === undefined || whole <= 0 ? undefined : Math.min(100, (part / whole) * 100);
