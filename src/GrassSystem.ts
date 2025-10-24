import {
  Vector3,
  WebGLRenderer,
  Texture,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { buildImposterAtlas } from "./imposterAtlasMaker";
import { createAtlasPointStandardMaterial } from "./AtlasPointStandardMaterial";
import { TerrainData } from "./terrain/TerrainData";
import { createWorldNormalMaterial } from "./WorldNormalMaterial";
import { getGrassTuft } from "./worldObjects/getGrassTuft";
import { hash1 } from "./utils/math";

const pointCountMax = 4000;
// const pointCount = 100056;
// const pointSpreadRadius = 40.0; // meters
// const pointSpreadRadius = 54.0; // meters

const __positions = new Float32Array(pointCountMax * 3);
const __uvs = new Float32Array(pointCountMax * 2);
const __rotNormals = new Float32Array(pointCountMax * 3);
const __rotationY = new Float32Array(pointCountMax);

const __weights = new Vector3();

const __posa = new Vector3();
const __posb = new Vector3();
const __posc = new Vector3();
const __posw = new Vector3();

const __norma = new Vector3();
const __normb = new Vector3();
const __normc = new Vector3();
const __normw = new Vector3();
export default class GrassSystem {
  grassTuft: Object3D;
  grassAtlasDiffuse: Texture;
  grassAtlasNormals: Texture;

  stepsYaw = 16;
  stepsPitch = 8;
  constructor(
    renderer: WebGLRenderer,
    private terrainData: TerrainData,
    private envMap: Texture
  ) {
    const tuftRadius = 0.25;

    this.grassTuft = getGrassTuft(tuftRadius);
    const worldNormalMaterial = createWorldNormalMaterial();

    this.grassAtlasDiffuse = buildImposterAtlas(this.grassTuft, renderer, {
      tileResolution: 256,
      stepsYaw: this.stepsYaw,
      stepsPitch: this.stepsPitch,
      fov: 35,
      radius: tuftRadius * 5,
      clearColor: 0x000000,
    });
    this.grassTuft.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.material = worldNormalMaterial;
      }
    });
    this.grassAtlasNormals = buildImposterAtlas(this.grassTuft, renderer, {
      tileResolution: 256,
      stepsYaw: this.stepsYaw,
      stepsPitch: this.stepsPitch,
      fov: 35,
      radius: tuftRadius * 5,
      clearColor: 0x000000,
    });
  }
  makePointCloudTile(aroundPosition: Vector3, size: number) {
    const pos = aroundPosition.clone();
    pos.y = this.terrainData.getSample(pos.x, pos.z).baseHeight;

    let pointCount = 0;

    for (let i = 0; i < pointCountMax; i++) {
      const x = (hash1(i) - 0.5) * size;
      const z = (hash1(i + 13) - 0.5) * size;

      // Sample terrain at world position and convert to local y relative to pos
      const worldX = pos.x + x;
      const worldZ = pos.z + z;
      const slope = this.terrainData.getSlope(worldX, worldZ);
      if (slope > 0.5) {
        continue;
      }
      const sample = this.terrainData.getSample(worldX, worldZ);
      const chance = hash1(i + 37);
      if (sample.baseHeight < 10 + chance * 2 || sample.pine > 0.5 || sample.pineWindow > chance) {
        continue;
      }
      const heightAt = sample.baseHeight;
      const y = heightAt - pos.y + 0.05; // slight offset above ground

      __positions[pointCount * 3 + 0] = x;
      __positions[pointCount * 3 + 1] = y;
      __positions[pointCount * 3 + 2] = z;

      const n = this.terrainData.getNormal(worldX, worldZ);
      // Store rotation normal for shader use
      __rotNormals[pointCount * 3 + 0] = n[0];
      __rotNormals[pointCount * 3 + 1] = -n[1];
      __rotNormals[pointCount * 3 + 2] = n[2];

      __uvs[pointCount * 2 + 0] = 0.5;
      __uvs[pointCount * 2 + 1] = 0.75;

      __rotationY[pointCount] = hash1(i + 61) * 6.283185307179586;
      pointCount++;
    }
    if (pointCount === 0) {
      return null;
    }
    const geom = new BufferGeometry();
    geom.setAttribute(
      "position",
      new Float32BufferAttribute(__positions.slice(0, pointCount * 3), 3)
    );
    geom.setAttribute(
      "normal",
      new Float32BufferAttribute(__rotNormals.slice(0, pointCount * 3), 3)
    );
    geom.setAttribute("uv", new Float32BufferAttribute(__uvs.slice(0, pointCount * 2), 2));

    geom.setAttribute("rotationY", new Float32BufferAttribute(__rotationY.slice(0, pointCount), 1));

    const mat = createAtlasPointStandardMaterial({
      atlasNormals: this.grassAtlasNormals,
      atlasDiffuse: this.grassAtlasDiffuse,
      stepsYaw: this.stepsYaw,
      stepsPitch: this.stepsPitch,
      pointSize: 596.0, // big square points
      envMap: this.envMap,
    });

    const points = new Points(geom, mat);

    points.onBeforeRender = (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) => {
      void scene;
      const rt = renderer.getRenderTarget();
      const pixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      const heightPx = rt ? rt.height : renderer.domElement.height * pixelRatio;

      // Vertical FOV in radians; for cube renders use 90°
      const fovRad =
        camera && camera.isPerspectiveCamera ? (camera.fov * Math.PI) / 180 : Math.PI / 2;

      mat.userData.pointSizeUniform.value = 0.2 * (heightPx / fovRad);
    };
    points.position.copy(pos);
    points.receiveShadow = true;
    points.updateMatrixWorld();
    points.frustumCulled = false; // since we use point size screenspace
    return points;
  }
  makePointCloudTileOnTerrainGeometry(aroundPosition: Vector3, geometry: BufferGeometry) {
    const pos = aroundPosition.clone();
    pos.y = this.terrainData.getSample(pos.x, pos.z).baseHeight;

    let pointCount = 0;

    const indexArr = geometry.getIndex()!.array;
    let a = 0;
    let b = 0;
    let c = 0;
    const posAttr = geometry.getAttribute("position");
    const invAOAndMaskAttr = geometry.getAttribute("invAOAndMask");
    const normalAttr = geometry.getAttribute("normal");
    const faces = ~~(indexArr.length / 3);
    for (let i = 0; i < pointCountMax; i++) {
      const ri = ~~(faces * hash1(i + 19)) * 3;
      a = indexArr[ri];
      b = indexArr[ri + 1];
      c = indexArr[ri + 2];

      __weights.set(hash1(i + 43), hash1(i + 47), hash1(i + 53));
      __weights.multiplyScalar(1 / (__weights.x + __weights.y + __weights.z));
      __posa.fromBufferAttribute(posAttr, a).multiplyScalar(__weights.x);
      __posb.fromBufferAttribute(posAttr, b).multiplyScalar(__weights.y);
      __posc.fromBufferAttribute(posAttr, c).multiplyScalar(__weights.z);

      __posw.copy(__posa).add(__posb).add(__posc);

      __norma.fromBufferAttribute(normalAttr, a).multiplyScalar(__weights.x);
      __normb.fromBufferAttribute(normalAttr, b).multiplyScalar(__weights.y);
      __normc.fromBufferAttribute(normalAttr, c).multiplyScalar(__weights.z);

      __normw.copy(__norma).add(__normb).add(__normc);
      __normw.normalize();

      const x = __posw.x;
      const y = __posw.y;
      const z = __posw.z;

      const shady =
        invAOAndMaskAttr.array[a * 2] * __weights.x +
        invAOAndMaskAttr.array[b * 2] * __weights.y +
        invAOAndMaskAttr.array[c * 2] * __weights.z;

      // Sample terrain at world position and convert to local y relative to pos
      const slope = __normw.y;
      if (slope < 0.85) {
        continue;
      }
      const chance = hash1(i + 67);
      if (y < 10 + chance * 2 || shady > chance * 0.5) {
        continue;
      }

      __positions[pointCount * 3 + 0] = x;
      __positions[pointCount * 3 + 1] = y + 0.05;
      __positions[pointCount * 3 + 2] = z;

      // Store rotation normal for shader use
      __rotNormals[pointCount * 3 + 0] = __normw.x;
      __rotNormals[pointCount * 3 + 1] = -__normw.y;
      __rotNormals[pointCount * 3 + 2] = __normw.z;

      __uvs[pointCount * 2 + 0] = 0.5;
      __uvs[pointCount * 2 + 1] = 0.75;

      __rotationY[pointCount] = hash1(i + 61) * 6.283185307179586;
      pointCount++;
    }
    if (pointCount === 0) {
      return null;
    }
    const geom = new BufferGeometry();
    geom.setAttribute(
      "position",
      new Float32BufferAttribute(__positions.slice(0, pointCount * 3), 3)
    );
    geom.setAttribute(
      "normal",
      new Float32BufferAttribute(__rotNormals.slice(0, pointCount * 3), 3)
    );
    geom.setAttribute("uv", new Float32BufferAttribute(__uvs.slice(0, pointCount * 2), 2));

    geom.setAttribute("rotationY", new Float32BufferAttribute(__rotationY.slice(0, pointCount), 1));

    const mat = createAtlasPointStandardMaterial({
      atlasNormals: this.grassAtlasNormals,
      atlasDiffuse: this.grassAtlasDiffuse,
      stepsYaw: this.stepsYaw,
      stepsPitch: this.stepsPitch,
      pointSize: 596.0, // big square points
      envMap: this.envMap,
    });

    const points = new Points(geom, mat);

    points.onBeforeRender = (renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera) => {
      void scene;
      const rt = renderer.getRenderTarget();
      const pixelRatio = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
      const heightPx = rt ? rt.height : renderer.domElement.height * pixelRatio;

      // Vertical FOV in radians; for cube renders use 90°
      const fovRad =
        camera && camera.isPerspectiveCamera ? (camera.fov * Math.PI) / 180 : Math.PI / 2;

      mat.userData.pointSizeUniform.value = 0.2 * (heightPx / fovRad);
    };
    // points.position.copy(pos);
    points.receiveShadow = true;
    points.frustumCulled = false; // since we use point size screenspace
    return points;
  }
}
