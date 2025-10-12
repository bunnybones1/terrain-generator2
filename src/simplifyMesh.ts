import { BufferGeometry, Float32BufferAttribute } from "three";

export function simplifyMesh(
  geometry: BufferGeometry,
  targetReduction: number = 0.5
): BufferGeometry {
  const pos = geometry.attributes.position;
  const index = geometry.index;

  if (!index) return geometry;

  // Build vertex and face data structures
  const vertexCount = pos.count;
  const vertices: Array<{ x: number; y: number; z: number; removed: boolean }> = [];

  for (let i = 0; i < vertexCount; i++) {
    vertices.push({
      x: pos.getX(i),
      y: pos.getY(i),
      z: pos.getZ(i),
      removed: false,
    });
  }

  // Build face list
  const faces: Array<{ v0: number; v1: number; v2: number; removed: boolean }> = [];
  for (let i = 0; i < index.count; i += 3) {
    faces.push({
      v0: index.getX(i),
      v1: index.getX(i + 1),
      v2: index.getX(i + 2),
      removed: false,
    });
  }

  // Build vertex-to-faces adjacency
  const vertexFaces: Map<number, Set<number>> = new Map();
  for (let i = 0; i < vertexCount; i++) {
    vertexFaces.set(i, new Set());
  }

  faces.forEach((face, faceIdx) => {
    if (!face.removed) {
      vertexFaces.get(face.v0)?.add(faceIdx);
      vertexFaces.get(face.v1)?.add(faceIdx);
      vertexFaces.get(face.v2)?.add(faceIdx);
    }
  });

  // Build vertex-to-vertex adjacency (neighbors)
  const vertexNeighbors: Map<number, Set<number>> = new Map();
  for (let i = 0; i < vertexCount; i++) {
    vertexNeighbors.set(i, new Set());
  }

  faces.forEach((face) => {
    if (!face.removed) {
      vertexNeighbors.get(face.v0)?.add(face.v1);
      vertexNeighbors.get(face.v0)?.add(face.v2);
      vertexNeighbors.get(face.v1)?.add(face.v0);
      vertexNeighbors.get(face.v1)?.add(face.v2);
      vertexNeighbors.get(face.v2)?.add(face.v0);
      vertexNeighbors.get(face.v2)?.add(face.v1);
    }
  });

  // Calculate collapse cost for a vertex
  function calculateCollapseCost(vIdx: number): { cost: number; target: number } {
    const neighbors = vertexNeighbors.get(vIdx);
    if (!neighbors || neighbors.size === 0) {
      return { cost: Infinity, target: -1 };
    }

    const v = vertices[vIdx];
    let minCost = Infinity;
    let bestTarget = -1;

    // Try collapsing to each neighbor
    for (const nIdx of neighbors) {
      if (vertices[nIdx].removed) continue;

      const n = vertices[nIdx];

      // Calculate geometric error (distance)
      const dx = v.x - n.x;
      const dy = v.y - n.y;
      const dz = v.z - n.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      // Calculate planarity cost (how flat are the affected faces)
      let planarityError = 0;
      const affectedFaces = vertexFaces.get(vIdx);

      if (affectedFaces) {
        for (const fIdx of affectedFaces) {
          const face = faces[fIdx];
          if (face.removed) continue;

          // Get the third vertex of the face
          let thirdIdx = -1;
          if (face.v0 === vIdx && face.v1 === nIdx) thirdIdx = face.v2;
          else if (face.v0 === vIdx && face.v2 === nIdx) thirdIdx = face.v1;
          else if (face.v1 === vIdx && face.v0 === nIdx) thirdIdx = face.v2;
          else if (face.v1 === vIdx && face.v2 === nIdx) thirdIdx = face.v0;
          else if (face.v2 === vIdx && face.v0 === nIdx) thirdIdx = face.v1;
          else if (face.v2 === vIdx && face.v1 === nIdx) thirdIdx = face.v0;

          if (thirdIdx >= 0 && !vertices[thirdIdx].removed) {
            const third = vertices[thirdIdx];

            // Calculate normal change
            const e1x = third.x - v.x,
              e1y = third.y - v.y,
              e1z = third.z - v.z;
            const e2x = n.x - v.x,
              e2y = n.y - v.y,
              e2z = n.z - v.z;

            const nx1 = e1y * e2z - e1z * e2y;
            const ny1 = e1z * e2x - e1x * e2z;
            const nz1 = e1x * e2y - e1y * e2x;
            const len1 = Math.sqrt(nx1 * nx1 + ny1 * ny1 + nz1 * nz1);

            if (len1 > 0) {
              planarityError += len1; // Use area as a proxy for importance
            }
          }
        }
      }

      // Combined cost: distance + planarity weight
      const cost = dist + planarityError * 0.1;

      if (cost < minCost) {
        minCost = cost;
        bestTarget = nIdx;
      }
    }

    return { cost: minCost, target: bestTarget };
  }

  // Initial scoring
  const vertexCosts: Map<number, { cost: number; target: number }> = new Map();
  for (let i = 0; i < vertexCount; i++) {
    if (!vertices[i].removed) {
      vertexCosts.set(i, calculateCollapseCost(i));
    }
  }

  // Simplification loop
  const targetVertexCount = Math.floor(vertexCount * (1 - targetReduction));
  let currentVertexCount = vertexCount;
  const minCostThreshold = 0.0005; // Minimum cost to consider for collapse

  while (currentVertexCount > targetVertexCount) {
    // Find vertex with minimum collapse cost
    let minCost = Infinity;
    let minVertex = -1;

    for (const [vIdx, costData] of vertexCosts) {
      if (!vertices[vIdx].removed && costData.cost < minCost) {
        minCost = costData.cost;
        minVertex = vIdx;
      }
    }

    if (minVertex === -1 || minCost < minCostThreshold) {
      break; // No more valid collapses
    }

    const targetVertex = vertexCosts.get(minVertex)!.target;
    if (targetVertex === -1 || vertices[targetVertex].removed) {
      vertexCosts.delete(minVertex);
      continue;
    }

    // Perform collapse: merge minVertex into targetVertex
    vertices[minVertex].removed = true;
    currentVertexCount--;

    // Update faces: remove degenerate faces and update vertex references
    const affectedFaces = vertexFaces.get(minVertex);
    if (affectedFaces) {
      for (const fIdx of affectedFaces) {
        const face = faces[fIdx];
        if (face.removed) continue;

        // Replace minVertex with targetVertex
        if (face.v0 === minVertex) face.v0 = targetVertex;
        if (face.v1 === minVertex) face.v1 = targetVertex;
        if (face.v2 === minVertex) face.v2 = targetVertex;

        // Remove degenerate faces (faces with duplicate vertices)
        if (face.v0 === face.v1 || face.v1 === face.v2 || face.v2 === face.v0) {
          face.removed = true;
          vertexFaces.get(face.v0)?.delete(fIdx);
          vertexFaces.get(face.v1)?.delete(fIdx);
          vertexFaces.get(face.v2)?.delete(fIdx);
        } else {
          // Update vertex-faces adjacency for target vertex
          vertexFaces.get(targetVertex)?.add(fIdx);
        }
      }
    }

    // Update vertex neighbors
    vertexFaces.get(minVertex)?.clear();
    const minNeighbors = vertexNeighbors.get(minVertex);
    if (minNeighbors) {
      for (const nIdx of minNeighbors) {
        vertexNeighbors.get(nIdx)?.delete(minVertex);
        if (nIdx !== targetVertex) {
          vertexNeighbors.get(nIdx)?.add(targetVertex);
          vertexNeighbors.get(targetVertex)?.add(nIdx);
        }
      }
      minNeighbors.clear();
    }

    // Recalculate costs for affected vertices
    const affectedVertices = new Set([targetVertex]);
    vertexNeighbors.get(targetVertex)?.forEach((v) => affectedVertices.add(v));

    for (const vIdx of affectedVertices) {
      if (!vertices[vIdx].removed) {
        vertexCosts.set(vIdx, calculateCollapseCost(vIdx));
      }
    }

    vertexCosts.delete(minVertex);
  }

  // Rebuild geometry
  const newVertices: number[] = [];
  const newIndices: number[] = [];
  const vertexRemap: Map<number, number> = new Map();

  for (let i = 0; i < vertexCount; i++) {
    if (!vertices[i].removed) {
      vertexRemap.set(i, newVertices.length / 3);
      newVertices.push(vertices[i].x, vertices[i].y, vertices[i].z);
    }
  }

  for (const face of faces) {
    if (!face.removed) {
      const i0 = vertexRemap.get(face.v0);
      const i1 = vertexRemap.get(face.v1);
      const i2 = vertexRemap.get(face.v2);

      if (i0 !== undefined && i1 !== undefined && i2 !== undefined) {
        newIndices.push(i0, i1, i2);
      }
    }
  }

  const simplifiedGeo = new BufferGeometry();
  simplifiedGeo.setAttribute("position", new Float32BufferAttribute(newVertices, 3));
  simplifiedGeo.setIndex(newIndices);
  simplifiedGeo.computeVertexNormals();

  return simplifiedGeo;
}
