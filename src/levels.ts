export type Surface = readonly [x: number, y: number, width: number];
export type Kind = 'bridge' | 'coinBridge' | 'bait' | 'spikes' | 'falling' | 'chase' | 'enemy' | 'hopper' | 'flyer' | 'coin' | 'fakeExit' | 'boss';
type ObjectData = readonly [kind: Kind, x: number, y: number, range?: number, warningMs?: number];

type Platform = { x: number; y: number; travel: number; channel: string };
type Switch = { x: number; y: number; channel: string; mounted: boolean };

interface Level {
  tint: number;
  start: number;
  checkpoints: number[];
  exit: number;
  escapeGate?: { x: number; y: number; triggerX: number };
  surfaces: Surface[];
  platforms: Platform[];
  switches: Switch[];
  objects: ObjectData[];
  lines: Array<readonly [number, string]>;
}

interface Property { name: string; value: string | number | boolean }
interface MapObject { type: string; x: number; y: number; width: number; properties?: Property[] }
interface TiledMap { properties: Property[]; layers: Array<{name: string; objects: MapObject[]}> }

const files = import.meta.glob<string>('./maps/*.tmj', { query: '?raw', eager: true, import: 'default' });
const property = (properties: Property[] | undefined, name: string) =>
  properties?.find(item => item.name === name)?.value;

const kinds = new Set<string>(['bridge','coinBridge','bait','spikes','falling','chase','enemy','hopper','flyer','coin','fakeExit','boss']);

function readMap(source: string): Level {
  const map: TiledMap = JSON.parse(source);
  const layer = (name: string) => map.layers.find(item => item.name === name)?.objects ?? [];
  const objects = layer('Objects');
  const gate = objects.find(item => item.type === 'escapeGate');
  const point = (type: string) => {
    const marker = objects.find(item => item.type === type);
    if (!marker) throw new Error(`Level needs a ${type} object`);
    return marker.x;
  };
  return {
    tint: Number(property(map.properties, 'tint')),
    start: point('start'),
    checkpoints: objects.filter(item => item.type === 'checkpoint').map(item => item.x),
    exit: point('exit'),
    escapeGate: gate && { x: gate.x, y: gate.y, triggerX: gate.x+gate.width },
    platforms: objects.filter(item=>item.type==='platform').map(({x,y,properties})=>({
      x,y,travel:Number(property(properties,'range')),channel:String(property(properties,'channel')),
    })),
    switches: objects.filter(item=>item.type==='switch').map(({x,y,properties})=>({
      x,y,channel:String(property(properties,'channel')),mounted:property(properties,'mounted')===true,
    })),
    surfaces: layer('Surfaces').map(({x, y, width}) => [x, y, width]),
    objects: objects.filter(({type}) => kinds.has(type)).map(item => {
      const warningMs = property(item.properties, 'warningMs');
      return [item.type as Kind, item.x, item.y, Number(property(item.properties, 'range') ?? 0),
        warningMs === undefined ? undefined : Number(warningMs)];
    }),
    lines: layer('Narrator').map(item => [item.x, String(property(item.properties, 'text'))]),
  };
}

export const levels = Object.keys(files).sort().map(file => readMap(files[file]));
