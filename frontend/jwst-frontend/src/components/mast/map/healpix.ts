/**
 * HEALPix NESTED `ang2pix` — the same algorithm as the backend's
 * `app/mast/healpix.py`, so a click on the coverage grid can be matched to
 * the cell the server counted (Górski et al. 2005; healpy's C code).
 * Pinned values in the test come from astropy_healpix.
 */

const TWO_OVER_PI = 2 / Math.PI;

function spreadBits(v: number): bigint {
  let x = BigInt(v);
  x = (x | (x << 16n)) & 0x0000ffff0000ffffn;
  x = (x | (x << 8n)) & 0x00ff00ff00ff00ffn;
  x = (x | (x << 4n)) & 0x0f0f0f0f0f0f0f0fn;
  x = (x | (x << 2n)) & 0x3333333333333333n;
  x = (x | (x << 1n)) & 0x5555555555555555n;
  return x;
}

export function orderForNside(nside: number): number {
  if (!Number.isInteger(nside) || nside <= 0 || (nside & (nside - 1)) !== 0) {
    throw new Error(`nside must be a power of two, got ${nside}`);
  }
  return Math.round(Math.log2(nside));
}

/** NESTED pixel index of (RA, Dec) in degrees. */
export function ang2pixNest(nside: number, raDeg: number, decDeg: number): number {
  const order = orderForNside(nside);
  const ra = ((raDeg % 360) + 360) % 360;
  const dec = Math.max(-90, Math.min(90, decDeg));
  const phi = (ra * Math.PI) / 180;
  const z = Math.sin((dec * Math.PI) / 180);
  const za = Math.abs(z);
  const tt = (phi % (2 * Math.PI)) * TWO_OVER_PI; // [0, 4)

  let face: number;
  let ix: number;
  let iy: number;
  if (za <= 2 / 3) {
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2);
    const jm = Math.floor(temp1 + temp2);
    const ifp = Math.floor(jp / nside);
    const ifm = Math.floor(jm / nside);
    face = ifp === ifm ? ifp | 4 : ifp < ifm ? ifp : ifm + 8;
    ix = jm & (nside - 1);
    iy = nside - (jp & (nside - 1)) - 1;
  } else {
    const ntt = Math.min(Math.floor(tt), 3);
    const tp = tt - ntt;
    const tmp = nside * Math.sqrt(3 * (1 - za));
    const jp = Math.min(Math.floor(tp * tmp), nside - 1);
    const jm = Math.min(Math.floor((1 - tp) * tmp), nside - 1);
    if (z >= 0) {
      face = ntt;
      ix = nside - jm - 1;
      iy = nside - jp - 1;
    } else {
      face = ntt + 8;
      ix = jp;
      iy = jm;
    }
  }
  const pix = (BigInt(face) << BigInt(2 * order)) + spreadBits(ix) + (spreadBits(iy) << 1n);
  return Number(pix);
}
