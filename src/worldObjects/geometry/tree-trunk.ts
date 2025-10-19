import { createNoise3D } from "simplex-noise";
import { BufferAttribute, CylinderGeometry, Matrix4 } from "three/src/Three.Core.js";

export function makeTreeTrunk(
  trunkRadius: number,
  trunkHeight: number,
  segs: number,
  simplex: ReturnType<typeof createNoise3D>
) {
  // Trunk
  const trunk = new CylinderGeometry(trunkRadius * 0.8, trunkRadius, trunkHeight, segs, segs, true);
  const tMat = new Matrix4().makeTranslation(0, trunkHeight * 0.5, 0);
  trunk.applyMatrix4(tMat);
  {
    const tuv = trunk.getAttribute("uv") as BufferAttribute | undefined;
    if (tuv) {
      const arr = tuv.array as Float32Array;
      for (let i = 0; i < tuv.count; i++) {
        arr[i * 2 + 0] *= 12.0; // scale U
        arr[i * 2 + 1] *= 4.0; // scale V
      }
      tuv.needsUpdate = true;
    }
  }

  const trunkPos = trunk.getAttribute("position") as BufferAttribute;
  if (!trunk.getAttribute("normal")) {
    trunk.computeVertexNormals();
  }
  const trunkNorm = trunk.getAttribute("normal") as BufferAttribute;

  // Prepare invAOAndMask: x = invAO based on vertex Y, y = mask (0 for trunk)
  const trunkInvAOAndMask = new Float32Array(trunkPos.count * 2);
  const noiseAmp = Math.max(0.002, trunkRadius * 0.5); // subtle bark irregularity
  const noiseFreq = 2.0 / Math.max(0.1, trunkRadius); // scale with thickness
  const octaves = 3;
  const lac = 2.0;
  const gain = 0.5;

  for (let vi = 0; vi < trunkPos.count; vi++) {
    const x = trunkPos.getX(vi);
    const y = trunkPos.getY(vi);
    const z = trunkPos.getZ(vi);

    // Multi-octave fbm noise
    let f = noiseFreq;
    let a = 1.0;
    let sum = 0.0;
    let ampSum = 0.0;
    for (let o = 0; o < octaves; o++) {
      const n = simplex(x * f, y * f, z * f); // -1..1
      sum += (n * 0.5 + 0.5) * a; // 0..1
      ampSum += a;
      f *= lac;
      a *= gain;
    }
    const fbm = ampSum > 0.0 ? sum / ampSum : 0.0;

    // Displace along normal
    const nx = trunkNorm.getX(vi);
    const ny = trunkNorm.getY(vi);
    const nz = trunkNorm.getZ(vi);
    const push = noiseAmp * (fbm - 0.5); // center around 0
    trunkPos.setXYZ(vi, x + nx * push, y + ny * push, z + nz * push);

    // invAO from normalized Y within trunk height (0 at base, 1 at top)
    const tY = Math.min(1, Math.max(0, (y - 0.0) / trunkHeight));
    trunkInvAOAndMask[vi * 2 + 0] = tY; // x: AO
    trunkInvAOAndMask[vi * 2 + 1] = 0.0; // y: mask=0 for trunk
  }
  trunkPos.needsUpdate = true;
  trunk.computeVertexNormals();

  trunk.setAttribute("pine", new BufferAttribute(new Float32Array(trunkPos.count).fill(0), 1));
  trunk.setAttribute("invAOAndMask", new BufferAttribute(trunkInvAOAndMask, 2));
  return trunk;
}
