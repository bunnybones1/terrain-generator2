import { MeshStandardMaterial, PerspectiveCamera, Scene } from "three";
import { StonesManager } from "./worldObjects/StonesManager";
import { TreeManager } from "./worldObjects/TreeManager";
import { TerrainSampler } from "./terrain/TerrainSampler";
import { DirtyAABB } from "./terrain/TerrainData";

export default class ScatteredObjectManager {
  updateAABBs(dirtyAABBs: DirtyAABB[] | undefined) {
    for (const layer of this.stonesLayers) {
      layer.update(this.camera, dirtyAABBs);
    }
    for (const layer of this.treeLayers) {
      layer.update(this.camera, dirtyAABBs);
    }
  }
  treeLayers: TreeManager[];
  stonesLayers: StonesManager[];
  constructor(
    scene: Scene,
    terrainSampler: TerrainSampler,
    terrainMat: MeshStandardMaterial,
    private camera: PerspectiveCamera
  ) {
    // Trees systems: shoreline pines
    const treeLayers: TreeManager[] = [
      new TreeManager("pines-L", scene, terrainSampler, terrainMat, 2001, {
        cellSize: 20,
        lodCapacities: [200, 400, 800, 1200, 2400],
        manageRadius: 100,
      }),
    ];
    this.treeLayers = treeLayers;
    // Stones systems: five layers from large/sparse to small/dense
    const stonesLayers: StonesManager[] = [
      // Layer 0: very large, very sparse, see from far away
      new StonesManager("stones-XL", scene, terrainSampler, terrainMat, 1001, {
        cellSize: 30,
        density: 0.00006, // ~0.06 per 1000 m^2
        stoneRadius: 8,
        lodCapacities: [10, 20, 30, 40, 50],
        manageRadius: 1000,
      }), // Layer 1: large, sparse
      new StonesManager("stones-L", scene, terrainSampler, terrainMat, 1002, {
        cellSize: 24,
        density: 0.0002,
        stoneRadius: 4,
        lodCapacities: [10, 20, 30, 40, 50],
        manageRadius: 600,
      }), // Layer 2: medium
      new StonesManager("stones-M", scene, terrainSampler, terrainMat, 1003, {
        cellSize: 18,
        density: 0.003,
        stoneRadius: 2,
        lodCapacities: [20, 40, 60, 80, 100],
        manageRadius: 400,
      }), // Layer 3: small
      new StonesManager("stones-S", scene, terrainSampler, terrainMat, 1004, {
        cellSize: 12,
        density: 0.03,
        stoneRadius: 1,
        lodCapacities: [40, 60, 80, 100, 200],
        manageRadius: 240,
      }), // Layer 4: very small, numerous, only near camera
      new StonesManager("stones-XS", scene, terrainSampler, terrainMat, 1005, {
        cellSize: 8,
        density: 0.1,
        stoneRadius: 0.5,
        lodCapacities: [100, 200, 300, 400, 500],
        manageRadius: 120,
      }),
    ];
    this.stonesLayers = stonesLayers;
  }
}
