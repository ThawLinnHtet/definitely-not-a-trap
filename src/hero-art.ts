import Phaser from 'phaser';

export const heroTexture = 'adventurer-motion';
const poses = ['idle', 'run-0', 'run-1', 'run-2', 'run-3', 'rise', 'fall', 'land'] as const;
const centers = [225, 207, 192, 193, 212, 197, 204, 220];

export function registerHeroFrames(textures: Phaser.Textures.TextureManager) {
  const texture = textures.get(heroTexture);
  const {width, height} = texture.getSourceImage();
  const cellWidth = width / 4;
  const cellHeight = height / 2;
  poses.forEach((pose, index) => {
    const frame = texture.add(pose, 0, index % 4 * cellWidth, Math.floor(index / 4) * cellHeight, cellWidth, cellHeight);
    if (!frame) return;
    frame.customPivot = true;
    frame.pivotX = centers[index] / 384;
    frame.pivotY = (index >= 4 ? 435 : 437) / 512;
  });
}
