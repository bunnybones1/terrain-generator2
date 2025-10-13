# Terrain System and Grass Subsystem

This document describes the architecture, data flow, configuration, and best practices for the Terrain System and the Grass Subsystem in this project. It is intended for developers integrating, extending, or tuning terrain rendering and vegetation.

## Overview

- Terrain System: Generates, manages, and renders large-scale heightfield-based terrain with LOD, streaming, and material splatting.
- Grass Subsystem: Instantiates dense vegetation (grass, small plants) efficiently over terrain using GPU-friendly techniques, wind animation, culling, and level of detail.

Both systems are designed to be modular: the terrain provides surfaces, masks, and sampling APIs; the grass subsystem consumes those to spawn and render instances.

## Features

Terrain System
- Heightfield-based terrain generation (procedural or from heightmap).
- Chunked quadtree LOD with screen-space error metric.
- Seamless LOD transitions with skirts or morphing.
- Multi-texture material splatting (albedo/normal/RG).
- Runtime streaming of height/weight tiles.
- Collision and sampling API for gameplay queries.

Grass Subsystem
- Density/biome-driven placement based on terrain masks.
- GPU instancing with per-instance variation (scale, hue, rotation).
- View frustum and distance culling, optional density LOD.
- Wind animation via vertex shader and global wind field.
- Support for multiple grass species with distinct materials.
- Runtime baking or on-the-fly spawning per visible terrain tile.

## Architecture

High-level components:
- TerrainData: Source of height, normal, and weight/splat maps per tile.
- TerrainQuadtree: Manages tile LOD, visibility, and streaming requests.
- TerrainRenderer: Builds mesh patches, handles material bindings and draw calls.
- TerrainSampler: Utility for height/normal queries and mask sampling.
- GrassManager: Oversees species definitions, density fields, and dispatch.
- GrassSpawner: Converts density and masks into instance buffers.
- GrassRenderer: Performs GPU instanced draws with wind and culling support.
- WindController: Supplies global wind parameters and gust noise textures.

Data flow:
1. TerrainQuadtree determines visible tiles and target LOD per frame.
2. TerrainRenderer requests tile meshes and binds material splat layers.
3. GrassManager receives visible tiles and queries TerrainSampler for masks.
4. GrassSpawner populates or updates instance buffers per tile/species.
5. GrassRenderer draws instances with per-species materials and wind params.

## Coordinate System and Units

- World units: 1 unit = 1 meter.
- Terrain tiles: N x N vertices per tile, with tile world size configurable.
- Height values are in meters; normals are calculated in tangent space for shading.

## Setup

1. Terrain Data
   - Provide a heightmap source (procedural generator or external heightmap).
   - Provide splat/weight maps (RGBA) for material blending and biome masks.
   - Optionally provide auxiliary masks: slope, curvature, moisture, temperature.

2. Terrain System Initialization
   - Configure quadtree LOD ranges (min/max LOD, error thresholds).
   - Set tile resolution (vertices per side) and world tile size.
   - Assign terrain materials and textures for each splat channel.

3. Grass Subsystem Initialization
   - Define grass species (mesh, material, base density, min/max scale).
   - Map species to biome/mask combinations and slope/height constraints.
   - Configure wind parameters and animation profiles.
   - Set instance budget per tile and global cap.

4. Rendering
   - Ensure the renderer supports hardware instancing and GPU culling if enabled.
   - Bind per-frame buffers: view/projection, wind, time, and lighting.

## Configuration

Terrain
- tileSize: World size per tile (meters).
- tileResolution: Vertices per side per tile (power of two plus one recommended).
- minLOD/maxLOD: Allowed LOD range for quadtree.
- screenSpaceError: Target pixel error for LOD selection.
- material:
  - splatTextures: Array of albedo/normal/AO for channels (R,G,B,A).
  - triplanar or UV scaling per channel.
- streaming:
  - cacheSize: Max tiles in memory.
  - preloadRadius: Tiles around camera to prefetch.

Grass
- species[]:
  - mesh: Low-poly grass blade or card.
  - material: Wind-enabled shader supporting hue/alpha variation.
  - baseDensity: Instances per square meter before masks.
  - scaleRange: [min, max] random scale.
  - colorJitter: Hue/Sat/Value randomization ranges.
  - cullDistances: [start, end] fade out range per species.
  - windResponse: bend strength, frequency, phase jitter.
- placement:
  - densityMap: Modulation from terrain masks (e.g., green channel).
  - slopeLimit: Max slope in degrees.
  - heightRange: [min, max] meters above sea level.
  - exclusionMasks: Paths, roads, water.
  - blueNoiseSampling: Toggle and radius to avoid clumping.
- performance:
  - instancesPerTileCap: Upper bound per tile to clamp density.
  - updateRate: Tiles per frame to spawn/update instances.
  - gpuCulling: Enable compute-based frustum/distance culling.

## Terrain Sampling API

Typical queries:
- float height = TerrainSampler.getHeight(worldPosXZ);
- float3 normal = TerrainSampler.getNormal(worldPosXZ);
- float4 masks = TerrainSampler.getSplatWeights(worldPosXZ); // RGBA 0..1
- float slope = TerrainSampler.getSlope(worldPosXZ);
- bool valid = TerrainSampler.raycast(rayOrigin, rayDir, out hit);

Use these in gameplay and in the GrassSpawner to decide placement.

## Grass Placement Logic

For each visible terrain tile:
- Sample density from selected mask channel(s).
- Reject locations by slope and height thresholds.
- Apply blue-noise or Poisson-disk sampling for natural distribution.
- Jitter instance transform: random yaw, scale, slight position offset.
- Store per-instance attributes:
  - transform: position, rotation, scale.
  - variation: color jitter, wind phase, bend factor.
- Write instances into a GPU buffer (structured or SSBO) for rendering.

## Shaders: Key Parameters

Vertex/instancing inputs:
- instanceTransform (float4x3 or quaternion + position + scale).
- instanceVariation (colorJitter, windPhase, bendStrength).
- windParams (direction, speed, amplitude, gustTexture, time).

Wind deformation:
- Base bend from direction and amplitude.
- High-frequency detail from gust noise texture sampled in world space.
- Optional per-species stiffness to vary response.

Fading and LOD:
- Compute per-instance distance to camera and apply fade between cullDistances.
- Cross-fade between LODs if species uses multiple meshes.

## Performance Tips

- Keep tileResolution modest; rely on LOD for distance.
- Use compressed textures for splat maps and masks.
- Cap instancesPerTileCap and tune baseDensity per species.
- Enable GPU culling for dense grass fields.
- Batch species with similar materials to reduce state changes.
- Stream tiles and instance buffers incrementally to avoid frame spikes.

## Troubleshooting

- Terrain popping at LOD boundaries:
  - Increase screenSpaceError or enable morphing/skirting.
- Grass appearing on roads/water:
  - Add exclusion masks and verify mask channel mapping.
- Performance drops when turning camera:
  - Reduce updateRate or preloadRadius; enable GPU culling.
- Wind animation too strong/weak:
  - Adjust windResponse per species and global amplitude.

## Extensibility

- Add new species by defining mesh/material and placement rule.
- Introduce biome-specific density maps by extending TerrainData.
- Add compute-based procedural placement that writes directly to instance buffers.
- Integrate pathing by sampling TerrainSampler in AI/navigation systems.

## Example Pseudocode

Terrain init:
- terrain = new TerrainSystem(config);
- terrain.loadHeightAndMasks(sources);

Grass init:
- grass = new GrassSubsystem(grassConfig, terrain.sampler);

Per frame:
- terrain.update(camera);
- visibleTiles = terrain.getVisibleTiles();
- grass.update(visibleTiles, camera);
- terrain.render();
- grass.render(camera);

## Versioning and Assets

- Height/mask assets should be versioned in a separate LFS store if large.
- Mesh and texture import settings should favor GPU instancing (no per-instance skinning).

## License

See LICENSE for details.
