import { Texture, TextureLoader, RepeatWrapping, LinearMipmapLinearFilter } from "three";

// Cache of textures by URL to deduplicate requests
const textureCache: Map<string, Texture> = new Map();

export function loadTex(url: string): Texture {
  // Return cached texture if already loaded
  const cached = textureCache.get(url);
  if (cached) return cached;

  const loader = new TextureLoader();
  const tex = loader.load(url);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;

  // Store in cache before returning
  textureCache.set(url, tex);
  return tex;
}
