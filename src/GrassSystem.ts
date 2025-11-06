import {
  Vector3,
  WebGLRenderer,
  Texture,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  Object3D,
  PerspectiveCamera,
  Scene,
} from "three";
import { createAtlasPointStandardMaterial } from "./AtlasPointStandardMaterial";
import { TerrainData } from "./terrain/TerrainData";
import { getGrassTuft } from "./worldObjects/getGrassTuft";
import { hash1 } from "./utils/math";
import { getSeaGrassTuft } from "./worldObjects/getSeaGrassTuft";
import PointCloudHelper, { pointCountMax, stepsYaw, stepsPitch } from "./helpers/PointCloudHelper";

// const pointCount = 100056;
// const pointSpreadRadius = 40.0; // meters
// const pointSpreadRadius = 54.0; // meters

const GRASS_ALTITUDE_START = 1.5;
const GRASS_ALTITUDE_END = 125;

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

  seagrassTuft: Object3D;
  helpers = new Map<string, PointCloudHelper>();
  constructor(
    renderer: WebGLRenderer,
    private terrainData: TerrainData,
    private envMap: Texture
  ) {
    const tuftRadius = 0.25;

    this.grassTuft = getGrassTuft(tuftRadius);
    this.seagrassTuft = getSeaGrassTuft(tuftRadius);

    this.helpers.set("grass", new PointCloudHelper(this.grassTuft, tuftRadius * 5, renderer));
    this.helpers.set("seaGrass", new PointCloudHelper(this.seagrassTuft, tuftRadius * 5, renderer));
  }
  makePointCloudTileOnTerrainGeometry(aroundPosition: Vector3, geometry: BufferGeometry) {
    const pos = aroundPosition.clone();
    pos.y = this.terrainData.getSample(pos.x, pos.z).baseHeight;

    const indexArr = geometry.getIndex()!.array;
    let a = 0;
    let b = 0;
    let c = 0;
    const posAttr = geometry.getAttribute("position");
    const invAOAndMaskAttr = geometry.getAttribute("invAOAndMask");
    const normalAttr = geometry.getAttribute("normal");
    const faces = ~~(indexArr.length / 3);

    //iterate over helpers and set counter to 0
    for (const helper of this.helpers.values()) {
      helper.counter = 0;
    }

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

      let helper = this.helpers.get("grass")!;

      if (
        y < GRASS_ALTITUDE_START + chance * 2 ||
        y > GRASS_ALTITUDE_END + chance * 16 ||
        shady > chance * 0.5
      ) {
        if (y < -3 + chance * 2) {
          helper = this.helpers.get("seaGrass")!;
        } else {
          continue;
        }
      }
      const pointCount = helper.counter;

      helper.positions[pointCount * 3 + 0] = x;
      helper.positions[pointCount * 3 + 1] = y + 0.05;
      // helper.positions[pointCount * 3 + 1] = y + 0.05;
      helper.positions[pointCount * 3 + 2] = z;

      // Store rotation normal for shader use
      helper.rotNormals[pointCount * 3 + 0] = __normw.x;
      helper.rotNormals[pointCount * 3 + 1] = -__normw.y;
      helper.rotNormals[pointCount * 3 + 2] = __normw.z;

      helper.uvs[pointCount * 2 + 0] = 0.5;
      helper.uvs[pointCount * 2 + 1] = 0.75;

      helper.rotationY[pointCount] = hash1(i + 61) * 6.283185307179586;
      helper.counter++;
    }

    return Array.from(this.helpers.values())
      .map((helper) => {
        // console.log("Generated points for helper:", helper, "count:", helper.counter);
        // }
        if (helper.counter === 0) {
          return null;
        }
        const geom = new BufferGeometry();
        geom.setAttribute(
          "position",
          new Float32BufferAttribute(helper.positions.slice(0, helper.counter * 3), 3)
        );
        geom.setAttribute(
          "normal",
          new Float32BufferAttribute(helper.rotNormals.slice(0, helper.counter * 3), 3)
        );
        geom.setAttribute(
          "uv",
          new Float32BufferAttribute(helper.uvs.slice(0, helper.counter * 2), 2)
        );

        geom.setAttribute(
          "rotationY",
          new Float32BufferAttribute(helper.rotationY.slice(0, helper.counter), 1)
        );

        const mat = createAtlasPointStandardMaterial({
          atlasNormals: helper.atlasNormals,
          atlasDiffuse: helper.atlasDiffuse,
          stepsYaw,
          stepsPitch,
          pointSize: 596.0, // big square points
          envMap: this.envMap,
        });

        const points = new Points(geom, mat);

        points.onBeforeRender = (
          renderer: WebGLRenderer,
          scene: Scene,
          camera: PerspectiveCamera
        ) => {
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
      })
      .filter((p) => p !== null);
  }
}
