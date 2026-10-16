import { Document, Format, NodeIO } from '@gltf-transform/core';
import type { MeshData } from '../generators/types';
import { srgbToLinear, textureFileName, type ExportedFile } from './util';
import { zip } from './zip';

function buildDocument(mesh: MeshData, base: string): Document {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'Asset Generator';
  const buffer = doc.createBuffer().setURI(`${base}.bin`);

  const texture = mesh.texture
    ? doc.createTexture('texture').setImage(mesh.texture.png).setMimeType('image/png').setURI(textureFileName(base))
    : null;

  const materials = mesh.materials.map((m) => {
    const mat = doc
      .createMaterial(m.name)
      .setBaseColorFactor([srgbToLinear(m.color[0]), srgbToLinear(m.color[1]), srgbToLinear(m.color[2]), 1])
      .setRoughnessFactor(m.roughness)
      .setMetallicFactor(m.metallic);
    if (m.textured && texture) mat.setBaseColorTexture(texture);
    if (m.emissive) mat.setEmissiveFactor([srgbToLinear(m.emissive[0]), srgbToLinear(m.emissive[1]), srgbToLinear(m.emissive[2])]);
    return mat;
  });

  const gltfMesh = doc.createMesh(base);
  for (const part of mesh.parts) {
    const accessor = (array: Float32Array<ArrayBuffer> | Uint32Array<ArrayBuffer>, type: 'VEC3' | 'VEC2' | 'SCALAR') =>
      doc.createAccessor().setArray(array).setType(type).setBuffer(buffer);
    const prim = doc
      .createPrimitive()
      .setAttribute('POSITION', accessor(new Float32Array(part.positions), 'VEC3'))
      .setAttribute('NORMAL', accessor(new Float32Array(part.normals), 'VEC3'))
      .setAttribute('TEXCOORD_0', accessor(new Float32Array(part.uvs), 'VEC2'))
      .setIndices(accessor(new Uint32Array(part.indices), 'SCALAR'))
      .setMaterial(materials[part.material]);
    gltfMesh.addPrimitive(prim);
  }

  const node = doc.createNode(base).setMesh(gltfMesh);
  doc.createScene(base).addChild(node);
  return doc;
}

export async function toGlb(mesh: MeshData, base: string): Promise<ExportedFile> {
  const data = await new NodeIO().writeBinary(buildDocument(mesh, base));
  return { data, fileName: `${base}.glb`, mime: 'model/gltf-binary' };
}

/** .gltf JSON + .bin buffer + texture PNG, zipped together. */
export async function toGltfZip(mesh: MeshData, base: string): Promise<ExportedFile> {
  const { json, resources } = await new NodeIO().writeJSON(buildDocument(mesh, base), { format: Format.GLTF });
  const entries = [
    { name: `${base}.gltf`, data: JSON.stringify(json, null, 2) },
    ...Object.entries(resources).map(([name, data]) => ({ name, data })),
  ];
  return { data: await zip(entries), fileName: `${base}_gltf.zip`, mime: 'application/zip' };
}
