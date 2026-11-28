import Phaser from 'phaser';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './style.css';
import { levels, type Kind } from './levels';
import { TouchControls } from './touch-controls';
import { heroTexture, registerHeroFrames } from './hero-art';

const W = 836;
const H = 470;
const CAMERA_ZOOM = .89;
const ROCK_WARNING_MS = 130;
const ROCK_TRIGGER_RANGE = 76;
const SPIKE_WARNING_MS = 250;
const SPIKE_TRIGGER_RANGE = 125;
const BAIT_WARNING_MS = 120;
const GATEKEEPER_STOMPS = 3;
const STARTING_LIVES = 2;
const LIVES_SCREEN_MS = 485;
const KEYBOARD_JUMP_BUFFER_MS = 128;
const TOUCH_JUMP_BUFFER_MS = 180;
const GATE_DROP_MS = 360;
const GATE_SPEED = 300;
function levelLabel(index: number) {
  return `Level ${index + 1}`;
}

const saveKey = 'definitely-not-a-trap-progress';
const hud = document.querySelector<HTMLElement>('#hud')!;
const label = document.querySelector<HTMLElement>('#level')!;
const coins = document.querySelector<HTMLElement>('#coins')!;
const livesScreen = document.querySelector<HTMLElement>('#lives-screen')!;
const livesCount = document.querySelector<HTMLElement>('#lives-count')!;
const livesAnnouncement = document.querySelector<HTMLElement>('#lives-announcement')!;
const caption = document.querySelector<HTMLElement>('#caption')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const menu = document.querySelector<HTMLElement>('#menu')!;
type Sprite = Phaser.Physics.Arcade.Image;
type Piece = { type: Kind; sprite: Sprite; x: number; y: number; range: number; warningMs: number; timer: number; direction: number; state: number };
type RailPlatform = { sprite: Sprite; left: number; right: number; channel: string; direction: number };
type PressureSwitch = { sprite: Phaser.GameObjects.Image; rail: RailPlatform; offset: number | null; y: number; pressed: boolean };
let unlocked = 0;
let muted = false;
try {
  const stored = JSON.parse(localStorage.getItem(saveKey) ?? '{}');
  const savedLevel: unknown = stored.unlocked;
  if (typeof savedLevel === 'number' && Number.isInteger(savedLevel)) {
    unlocked = Phaser.Math.Clamp(savedLevel, 0, levels.length - 1);
  }
  muted = stored.muted === true;
} catch { /* Storage can be unavailable in private contexts. */ }

function saveProgress() {
  try { localStorage.setItem(saveKey, JSON.stringify({ unlocked, muted })); }
  catch { /* Progress remains available for this session. */ }
}

let audio: AudioContext | undefined;
function sound(frequency: number, duration = .11, end = frequency) {
  if (muted || !window.AudioContext) return;
  try {
    audio ??= new AudioContext();
    if (audio.state !== 'running') void audio.resume().catch(() => {});
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(end, audio.currentTime + duration);
    gain.gain.setValueAtTime(.075, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + duration);
  } catch { /* The game remains playable without sound. */ }
}

type Action = { title: string; run: () => void; disabled?: boolean };
function showMenu(title: string, detail: string, actions: Action[]) {
  menu.replaceChildren();
  const heading = document.createElement('h1');
  heading.textContent = title;
  const description = document.createElement('p');
  description.textContent = detail;
  const group = document.createElement('div');
  group.className = 'actions';
  actions.forEach(action => {
    const button = document.createElement('button');
    button.textContent = action.title;
    button.disabled = !!action.disabled;
    button.addEventListener('click', action.run);
    group.append(button);
  });
  menu.append(heading, description, group);
  overlay.hidden = false;
  group.querySelector<HTMLButtonElement>('button:enabled')?.focus();
}
function closeMenu() {
  if (overlay.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  overlay.hidden = true;
}

class Adventure extends Phaser.Scene {
  private index = 0;
  private checkpoint?: number;
  private touch!: TouchControls;
  private gatekeeperDefeated = false;
  private lives = STARTING_LIVES;
  private collected = new Set<number>();
  private paused = true;
  private dead = false;
  private onTitle = true;
  private started = false;
  private finishOpen = false;
  private escapeGate?: { x: number; startedAt?: number };
  private lastGround = -1000;
  private jumpBufferedUntil = 0;
  private stride = 0;
  private wasGrounded = false;
  private fallSpeed = 0;
  private landUntil = 0;
  private jumpHeld = false;
  private dust!: Phaser.GameObjects.Particles.ParticleEmitter;
  private coinSpark!: Phaser.GameObjects.Particles.ParticleEmitter;
  private scenery!: Phaser.GameObjects.Image;
  private openingScenery?: Phaser.GameObjects.Container;
  private captionUntil = 0;
  private clock = 0;
  private scaleCamera = 0;
  private player!: Sprite;
  private hero!: Phaser.GameObjects.Image;
  private terrain!: Phaser.Physics.Arcade.StaticGroup;
  private exitFlag!: Phaser.GameObjects.Image;
  private draw!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private pieces: Piece[] = [];
  private lines = new Set<number>();
  private actors: Phaser.GameObjects.GameObject[] = [];
  private landingArt: Phaser.GameObjects.Components.Visible[] = [];
  private colliders: Phaser.Physics.Arcade.Collider[] = [];
  private railPlatforms: RailPlatform[] = [];
  private pressureSwitches: PressureSwitch[] = [];

  constructor() { super('adventure'); }
  preload() {
    this.load.image('landscape', '/art/grassland.png');
    this.load.image('worlds', '/art/adventure-worlds.png');
    this.load.image('clockworks', '/art/clockworks.png');
    this.load.image(heroTexture, '/art/adventurer-motion.png');
  }
  create() {
    this.makeTextures();
    registerHeroFrames(this.textures);
    const worlds = this.textures.get('worlds');
    const {width, height} = worlds.getSourceImage();
    const halfWidth = Math.floor(width/2);
    const halfHeight = Math.floor(height/2);
    for (let i=0;i<4;i++) {
      worlds.add(`world-${i+1}`,0,(i%2)*halfWidth,Math.floor(i/2)*halfHeight,halfWidth,halfHeight);
    }
    this.draw = this.add.graphics().setDepth(6);
    this.keys = this.input.keyboard!.addKeys('LEFT,RIGHT,UP,A,D,W,SPACE,ESC,R') as typeof this.keys;
    this.touch=new TouchControls(()=>this.canPlay(),()=>this.pauseGame());
    const togglePause = (event: KeyboardEvent) => {
      if (this.touch.portrait || event.repeat || this.onTitle || this.dead || this.finishOpen || !livesScreen.hidden) return;
      if (event.code === 'Escape' && document.fullscreenElement) return;
      event.preventDefault();
      if (this.paused) this.resumeGame(); else this.pauseGame();
    };
    this.input.keyboard!.on('keydown-ESC', togglePause);
    this.input.keyboard!.on('keydown-P', togglePause);
    this.input.keyboard!.on('keydown-R', () => {
      if (!this.touch.portrait && this.canPlay()) this.die();
    });
    this.game.events.on(Phaser.Core.Events.BLUR, () => {
      if (this.canPlay()) this.pauseGame();
    });
    this.loadLevel(0);
    this.scale.on(Phaser.Scale.Events.RESIZE,this.positionCamera,this);
    const stage=document.querySelector<HTMLElement>('#stage')!;
    const resize=new ResizeObserver(([entry])=>{
      const {width,height}=entry.contentRect;
      if (width>0 && height>0 && (width!==this.scale.width || height!==this.scale.height)) {
        this.scale.setParentSize(width,height);
      }
    });
    resize.observe(stage);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN,()=>resize.disconnect());
    this.title();
  }
  private makeTextures() {
    const g = this.make.graphics({x:0,y:0}, false);
    const texture = (name: string, w: number, h: number, paint: () => void) => {
      g.clear(); paint(); g.generateTexture(name,w,h);
    };
    const fill = (color: number,x: number,y: number,w: number,h: number) => g.fillStyle(color).fillRect(x,y,w,h);
    texture('body',30,51,()=>fill(0xffffff,0,0,30,51));
    texture('dust',7,5,()=>{
      fill(0xb78c61,0,2,7,3); fill(0xe1bf8e,2,0,3,4);
    });
    texture('rail-platform',100,17,()=>{
      fill(0x312b32,0,2,100,15); fill(0x805942,4,4,92,10);
      fill(0xebba74,2,0,96,4); fill(0xa67c51,7,5,86,2);
      for (let x=8;x<94;x+=21) {
        fill(0x473844,x,8,12,6); fill(0xe2a666,x+3,8,5,4);
      }
    });
    texture('pressure-switch',24,7,()=>{
      fill(0x372d32,0,3,24,4); fill(0xbe562d,2,1,20,4);fill(0xffbd68,5,0,14,2);
    });
    texture('plank',50,19,()=>{
      fill(0x432820,0,2,50,17); fill(0x825334,2,5,46,11); fill(0xc58e50,1,1,47,5);
      fill(0xe7b579,3,0,45,2); fill(0x583729,7,9,30,2); fill(0xb4a187,6,8,3,4);
      fill(0xb4a187,42,8,3,4);
    });
    texture('coin-spark',5,5,()=>{
      fill(0xffcc64,2,0,1,5); fill(0xffe5a2,0,2,5,1);
    });
    texture('coin',15,19,()=>{
      fill(0x7d4b23,3,0,9,19); fill(0x7d4b23,0,4,15,11);
      fill(0xffc54e,4,2,7,15); fill(0xeaa039,2,5,11,9); fill(0xffe591,5,4,2,9);
    });
    const creature = (name: string, color: number, w: number, h: number) => texture(name,w,h,()=>{
      fill(0x33242b,0,8,w,h-8); fill(color,4,3,w-8,h-9); fill(color,10,0,w-20,7);
      fill(0xf9e6b5,w-19,10,9,7); fill(0x312530,w-13,11,4,6);
      fill(0x503428,4,h-6,8,6); fill(0x503428,w-12,h-6,8,6);
    });
    creature('enemy',0xaf5740,35,28);
    creature('hopper',0x67974d,31,25);
    creature('flyer',0x745c9c,43,24);
    creature('chase',0xb4413b,56,48);
    creature('boss',0x8a526a,75,63);
    texture('rock',37,38,()=>{
      const facet=(color: number,coords: [number,number][]) =>
        g.fillStyle(color).fillPoints(coords.map(([x,y])=>({x,y})),true);
      facet(0x382d32,[[0,15],[8,6],[16,2],[29,4],[36,13],[37,27],[27,36],[12,37],[3,29]]);
      facet(0x7a6561,[[3,16],[10,8],[17,5],[28,7],[32,14],[26,24],[13,27],[5,24]]);
      facet(0xa5917e,[[10,9],[18,5],[28,7],[29,12],[22,15],[12,16],[5,20],[6,15]]);
      facet(0x57444a,[[32,14],[35,26],[26,34],[13,34],[5,26],[13,27],[25,23]]);
      facet(0x615151,[[22,14],[28,12],[25,22],[14,25],[16,20]]);
      fill(0xc1aa8f,12,9,7,2); fill(0xc1aa8f,9,11,4,2); fill(0x9c8375,9,21,4,2);
      fill(0x775c5e,22,27,5,2); fill(0x907570,30,19,3,3);
    });
    texture('spike',41,26,()=>{
      g.fillStyle(0x493942);
      for (let i=0;i<3;i++) g.fillTriangle(i*13,25,i*13+7,0,i*13+15,25);
      g.fillStyle(0xd7ba93);
      for (let i=0;i<3;i++) g.fillTriangle(i*13+3,23,i*13+7,2,i*13+10,23);
    });
    texture('exit',36,62,()=>{
      fill(0x533723,4,0,5,62); fill(0xd9ad6c,5,1,2,60); fill(0x57723b,8,4,26,20);
      fill(0x91a755,9,4,24,3); fill(0xffe3a4,16,9,11,3); fill(0xffe3a4,23,12,4,4);
    });
    g.destroy();
  }
  private track<T extends Phaser.GameObjects.GameObject>(object: T): T {
    this.actors.push(object);
    return object;
  }
  private loadLevel(index: number) {
    this.touch.clear();
    this.index = index;
    const map = levels[index];
    for (const collider of this.colliders) collider.destroy();
    this.colliders = [];
    this.railPlatforms=[];
    this.pressureSwitches=[];
    this.terrain?.destroy(true);
    this.actors.forEach(object => object.destroy());
    this.actors = [];
    this.landingArt = [];
    this.pieces = [];
    this.lines.clear();
    this.dead = false;
    this.finishOpen = false;
    this.escapeGate = map.escapeGate && { x: map.escapeGate.x };
    this.lastGround = -1000;
    this.jumpBufferedUntil = 0;
    this.stride = 0;
    this.wasGrounded = false;
    this.fallSpeed = 0;
    this.landUntil = 0;
    this.jumpHeld = false;
    this.clock = 0;
    this.captionUntil = 0;
    this.scaleCamera = 0;
    caption.textContent = '';
    label.textContent = levelLabel(index);
    this.syncCoinCount();
    livesScreen.hidden=true;
    this.cameras.main.setScroll(0,0);
    this.draw.clear();
    const scenery=index===5 ? this.add.image(0,0,'clockworks') : this.add.image(0,0,'worlds',`world-${index || 1}`);
    this.scenery=this.track(scenery.setOrigin(0).setScrollFactor(0).setDepth(-6));
    this.openingScenery=index===0 ? this.makeOpeningScenery() : undefined;
    this.terrain = this.physics.add.staticGroup();
    for (const [x,y,w] of map.surfaces) {
      const surfaceDepth=index===0 ? (y<=240 ? 14 : 36) : (y<=255 ? 14 : y<300 ? 22 : 36);
      const floor = this.terrain.create(x+w/2,y+surfaceDepth/2,'body') as Phaser.Physics.Arcade.Image;
      floor.setDisplaySize(w,surfaceDepth).setVisible(false).refreshBody();
      if (index>0 || x>=W) this.paintTerrain(x,y,w);
      else if (y>=300) this.paintTerrain(x,y,w,-5.5);
      if (index===0 && x<W && y<300) {
        const ledge = this.track(this.add.graphics().setDepth(1).setVisible(false));
        ledge.fillStyle(0x624735).fillRect(x,y,w,13);
        ledge.fillStyle(0xc18e56).fillRect(x+3,y+4,w-6,6);
        ledge.fillStyle(0x859037).fillRect(x,y,w,4);
        ledge.fillStyle(0xb7b54b).fillRect(x+2,y,w-4,2);
        this.landingArt.push(ledge);
      }
    }
    for (const [x,y,width] of map.brakeZones) {
      const stripes=this.track(this.add.graphics().setDepth(2));
      stripes.fillStyle(0x352727).fillRect(x,y-3,width,9);
      stripes.fillStyle(0xf2bd65);
      for (let left=x+3;left+9<x+width;left+=9) {
        stripes.fillPoints([{x:left,y:y+4},{x:left+4,y:y+4},{x:left+9,y:y-2},{x:left+5,y:y-2}],true);
      }
    }
    const spawnX = this.checkpoint ?? map.start;
    this.player = this.track(this.physics.add.image(spawnX,this.groundAt(spawnX)-28,'body'))
      .setVisible(false).setMaxVelocity(248,720);
    this.hero = this.track(this.add.image(0,0,heroTexture,'idle').setDepth(8).setScale(.235));
    this.dust = this.track(this.add.particles(0,0,'dust',{
      emitting:false, lifespan:{min:140,max:340}, speedX:{min:-78,max:78},
      speedY:{min:-92,max:-28}, gravityY:230, scale:{start:.9,end:.25}, alpha:{start:.85,end:0},
    }).setDepth(7));
    this.coinSpark = this.track(this.add.particles(0,0,'coin-spark',{
      emitting:false,lifespan:{min:120,max:310},speed:{min:45,max:126},gravityY:170,
      scale:{start:1.2,end:.35},alpha:{start:1,end:0},
    }).setDepth(10));
    this.syncHero();
    this.colliders.push(this.physics.add.collider(this.player,this.terrain));
    for (const {x,y,travel,channel} of map.platforms) this.addRailPlatform(x,y,travel,channel);
    for (const {x,y,channel,mounted} of map.switches) {
      const rail=this.railPlatforms.find(platform=>platform.channel===channel);
      if (!rail) continue;
      const sprite=this.track(this.add.image(x,y,'pressure-switch').setOrigin(.5,1).setDepth(5));
      this.pressureSwitches.push({sprite,rail,offset:mounted?x-rail.left:null,y,pressed:false});
    }
    map.objects.forEach(([type,x,y,range,warningMs],i) => {
      if (this.gatekeeperDefeated && (type==='boss' || type==='fakeExit')) return;
      if (type==='bridge' || type==='coinBridge') {
        if (range) this.addBridge(x,y,range,type==='coinBridge');
      } else if (type!=='coin' || !this.collected.has(i)) this.spawn(type,x,y,range,i,warningMs);
    });
    this.exitFlag=this.track(this.add.image(map.exit,this.groundAt(map.exit),'exit').setOrigin(.5,1).setDepth(4));
    this.exitFlag.setVisible(this.gatekeeperDefeated || !map.objects.some(([type])=>type==='boss'));
    this.updateEscapeGate(0);
    if (index===0) {
      this.landingArt.push(...this.pieces.filter(piece=>piece.x>594 && piece.x<W && piece.type!=='bridge')
        .map(piece=>piece.sprite));
      this.landingArt.forEach(object=>object.setVisible(false));
    }
    for (const x of map.checkpoints) {
      if (index===0 && x<W) continue;
      this.track(this.add.image(x,this.groundAt(x),'exit').setOrigin(.5,1).setDepth(4)
        .setTint(0xe7ac70).setScale(.66));
    }
    this.scaleCamera=this.scrollTarget(spawnX);
    this.positionCamera();
    if (this.paused) this.physics.pause(); else this.physics.resume();
  }
  private groundAt(x: number) {
    return Math.max(...levels[this.index].surfaces.filter(([left,,width])=>x>=left && x<left+width)
      .map(([,y])=>y));
  }
  private scrollTarget(x: number) {
    const lookAhead=this.index===0 ? 424+281*(1-Phaser.Math.Clamp((x-705)/450,0,1)) : 424;
    return Phaser.Math.Clamp(x-lookAhead,0,Math.max(0,levels[this.index].exit+82-W));
  }
  private positionCamera() {
    const camera=this.cameras.main;
    const {width,height}=this.scale.gameSize;
    if (!width || !height || !this.player) return;

    // Keep pixel proportions and reveal more scenery on larger aspect ratios.
    const zoom=Math.min(width/520,height/H)*CAMERA_ZOOM;
    const viewWidth=width/zoom;
    const viewHeight=height/zoom;
    const openingLookAhead=this.index===0
      ? Math.min(Math.max(0,viewWidth-W)/2,W*.14)*(1-Phaser.Math.Clamp(this.scaleCamera/W,0,1))
      : 0;
    const centerX=viewWidth>=W ? this.scaleCamera+W/2+openingLookAhead : Phaser.Math.Clamp(
      this.player.x+viewWidth*.08,this.scaleCamera+viewWidth/2,this.scaleCamera+W-viewWidth/2,
    );
    const skyRoom=Math.min(Math.max(0,viewHeight-H)/2,H*.14);
    camera.setZoom(zoom).setScroll(centerX-width/2,(H-height)/2-skyRoom);

    const panDistance=Math.max(W,levels[this.index].exit+82-W);
    this.fitScenery(this.scenery,width,height,viewWidth,viewHeight,
      100*Phaser.Math.Clamp(this.scaleCamera/panDistance,0,1),100);
    const openingAlpha=1-Phaser.Math.Clamp(this.scaleCamera/360,0,1);
    this.openingScenery?.setAlpha(openingAlpha).setVisible(openingAlpha>0);
  }
  private makeOpeningScenery() {
    const backdrop=this.track(this.add.container(0,0).setDepth(-5));
    // Reflect edge pixels into the wider camera view while keeping terrain aligned.
    for (const row of [-1,0,1]) {
      for (const col of [-1,0,1]) {
        backdrop.add(this.add.image((col+.5)*W,(row+.5)*H,'landscape')
          .setDisplaySize(W,H).setFlip(col!==0,row!==0));
      }
    }
    return backdrop;
  }
  private fitScenery(image: Phaser.GameObjects.Image,width: number,height: number,
    viewWidth: number,viewHeight: number,pan: number,overscan: number) {
    const scale=Math.max((viewWidth+overscan)/image.width,viewHeight/image.height);
    image.setScale(scale).setPosition(
      (width-image.width*scale+overscan)/2-pan,(height-image.height*scale)/2,
    );
  }
  private addRailPlatform(x: number,y: number,travel: number,channel: string) {
    const sprite=this.track(this.physics.add.image(x,y+8.5,'rail-platform')).setImmovable(true).setDepth(3);
    const deck=sprite.body as Phaser.Physics.Arcade.Body;
    deck.setAllowGravity(false).setFrictionX(1);
    const track=this.track(this.add.graphics().setDepth(2));
    track.fillStyle(0x392f3a).fillRect(x,y+28,travel,5);
    track.fillStyle(0x96755b).fillRect(x,y+27,travel,2);
    for (const stop of [x,x+travel]) track.fillStyle(0xbe945f).fillRect(stop-3,y+23,6,12);

    this.railPlatforms.push({sprite,left:x,right:x+travel,channel,direction:1});
    this.colliders.push(this.physics.add.collider(this.player,sprite,undefined,()=>{
      const rider=this.player.body as Phaser.Physics.Arcade.Body;
      return rider.velocity.y>=0 && rider.prev.y+rider.height<=deck.top+4;
    }));
  }
  private updateRails() {
    const player=this.player.body as Phaser.Physics.Arcade.Body;
    for (const plate of this.pressureSwitches) {
      const {sprite,rail,offset,y}=plate;
      if (offset!==null) sprite.setX(rail.sprite.x+offset);
      const pressed=Math.abs(player.center.x-sprite.x)<14 && Math.abs(player.bottom-y)<4
        && (player.blocked.down||player.touching.down);
      if (pressed===plate.pressed) continue;
      if (pressed) {
        rail.direction*=-1;
        sprite.setTint(0xffddb0);
        sound(380,.13,160);
      } else sprite.clearTint();
      sprite.setY(y+(pressed?2:0));
      plate.pressed=pressed;
    }
    for (const rail of this.railPlatforms) {
      const {sprite,left,right}=rail;
      const body=sprite.body as Phaser.Physics.Arcade.Body;
      const x=body.center.x;
      if (x<=left && rail.direction<0) {
        body.reset(left,sprite.y);
        rail.direction=1;
      } else if (x>=right && rail.direction>0) {
        body.reset(right,sprite.y);
        rail.direction=-1;
      }
      sprite.setVelocityX(112*rail.direction);
    }
  }
  private addBridge(start: number,y: number,width: number,coinTriggered: boolean) {
    const supports=this.track(this.add.graphics().setDepth(2));
    for (const [x,direction] of [[start+23,1],[start+width-9,-1]]) {
      supports.fillStyle(0x4a2a24).fillRect(x-8,y+1,16,125);
      supports.fillStyle(0x865131).fillRect(x-5,y+4,9,114);
      supports.lineStyle(12,0x593528).beginPath().moveTo(x,y+62).lineTo(x+direction*45,y+9).strokePath();
      supports.fillStyle(0x9c6440).fillRect(x-9,y-16,18,10);
      supports.fillStyle(0x553526).fillRect(x-11,y-7,22,6);
      supports.fillStyle(0xc19458).fillRect(x-10,y-3,20,3).fillRect(x-10,y+35,20,4);
    }
    const planks: Piece[] = [];
    for (let x=start;x<start+width;x+=49) {
      const plank=this.spawn('bridge',x+24,y);
      planks.push(plank);
      this.colliders.push(this.physics.add.collider(this.player,plank.sprite,()=>{
        if (!coinTriggered && plank.state===0) {
          plank.state=1;
          plank.timer=this.clock+590;
          sound(112,.09,80);
        }
      },()=>plank.state<2));
    }
    if (!coinTriggered) return;
    const coin=this.track(this.physics.add.staticImage(start+width-150,y-27,'coin')).setDepth(4);
    this.colliders.push(this.physics.add.overlap(this.player,coin,()=>{
      if (this.dead) return;
      coin.disableBody(true,true);
      this.coinSpark.emitParticleAt(coin.x,coin.y,10);
      this.dust.emitParticleAt(coin.x,y,7);
      for (const plank of planks) {
        plank.state=1;
        plank.timer=this.clock;
      }
      this.say('That coin dropped the bridge.');
      sound(280,.07,115);
      sound(110,.22,54);
    }));
  }
  private paintTerrain(x: number,y: number,w: number,depthOrder=1) {
    const palettes = [
      [0x472b24,0x805239,0xb17a4d,0xd29b61,0x6d7a30,0xa8ac48],
      [0x302c26,0x554434,0x826043,0xb68a58,0x55723b,0x91a252],
      [0x272837,0x414050,0x626075,0x8a8599,0x57586f,0x908da9],
      [0x49302d,0x744d3c,0xa16a48,0xd59a65,0x8a573c,0xd49965],
      [0x35292d,0x56404a,0x76545a,0xae7c75,0x684b53,0xaa7971],
      [0x272b39,0x414756,0x60656d,0x939287,0x7d6457,0xc39563],
    ];
    const [shadow,stone,mid,light,rim,edge]=palettes[this.index];
    const graphics=this.track(this.add.graphics().setDepth(depthOrder));
    const tall=y>=300;
    const depth=tall ? H-y+4 : y<=(this.index===0 ? 240 : 255) ? 14 : 22;
    const pattern=new Phaser.Math.RandomDataGenerator([`${this.index}:${x}:${y}`]);

    graphics.fillStyle(shadow).fillRect(x,y,w,depth);
    graphics.fillStyle(stone).fillRect(x+3,y+3,w-6,depth-5);
    for (let row=11;row<depth-4;row+=19) {
      let offset=row%2===0 ? 8 : 3;
      while (offset<w-8) {
        const length=Math.min(pattern.between(12,38),w-offset-3);
        const height=Math.min(pattern.between(7,17),depth-row-1);
        const top=y+row+pattern.between(-2,2);
        graphics.fillStyle(mid,.72).fillRect(x+offset,top+2,length,height-3);
        graphics.fillStyle(light,.35).fillRect(x+offset+2,top,length-5,3);
        graphics.fillStyle(shadow,.63).fillRect(x+offset+5,top+height-1,length-5,2);
        offset+=length+pattern.between(2,7);
      }
    }
    graphics.fillStyle(rim).fillRect(x,y,w,7);
    graphics.fillStyle(edge).fillRect(x+2,y,w-4,3);
    for (let offset=5;offset<w-9;offset+=pattern.between(6,15)) {
      graphics.fillStyle(rim).fillRect(x+offset,y+6,pattern.between(3,7),pattern.between(2,6));
      graphics.fillStyle(light,.72).fillRect(x+offset-2,y+2,3,2);
    }
  }
  private spawn(type: Exclude<Kind,'coinBridge'>,x: number,y: number,range=0,id=-1,warningMs=SPIKE_WARNING_MS) {
    const texture = type==='bridge' ? 'plank' : type==='bait' ? 'coin' : type==='falling' ? 'rock' : (type==='spikes' || type==='jumpSpikes') ? 'spike' : type==='fakeExit' ? 'exit' : type;
    const sprite = this.track(this.physics.add.image(x,y,texture)).setDepth(4);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    sprite.setImmovable();
    const piece: Piece = {type,sprite,x,y,range,warningMs,timer:0,direction:1,state:0};
    this.pieces.push(piece);
    if (type==='bridge') {
      sprite.setY(y+sprite.height/2).setDepth(3);
      body.updateFromGameObject();
      return piece;
    }
    if (type==='spikes' || type==='jumpSpikes') sprite.setY(y-12).setVisible(false);
    else if (type==='falling' || type==='chase' || type==='boss') sprite.setVisible(false);
    else if (type!=='coin' && type!=='bait' && type!=='flyer') sprite.setY(y-sprite.height/2);
    body.updateFromGameObject();
    if (type==='fakeExit') return piece;
    this.colliders.push(this.physics.add.overlap(this.player,sprite,()=>{
      if (this.dead) return;
      if (type==='spikes' || type==='jumpSpikes') {
        if (type==='jumpSpikes' && piece.state<2) return;
        this.raiseSpikes(piece);
        this.die(sprite.x);
        return;
      }
      if (!sprite.visible) return;
      if (type==='coin' || type==='bait') {
        if (type==='coin') {
          this.collected.add(id);
          sprite.disableBody(true,true);
          this.syncCoinCount();
          this.coinSpark.emitParticleAt(sprite.x,sprite.y,7);
          const popup=this.add.text(sprite.x,sprite.y-13,'+1',{
            fontFamily:'Pixelify Sans, monospace',fontSize:'18px',color:'#ffdf83',stroke:'#382521',strokeThickness:3,
          }).setOrigin(.5,1).setDepth(11);
          this.actors.push(popup);
          this.tweens.add({targets:popup,y:popup.y-29,alpha:0,duration:480,ease:'Quad.Out',onComplete:()=>{
            Phaser.Utils.Array.Remove(this.actors,popup);
            popup.destroy();
          }});
          sound(690,.12,990);
        } else if (piece.state===0) {
          piece.state=1;
          piece.timer=this.clock+BAIT_WARNING_MS;
          sprite.setTexture('spike').setY(y+15).setTint(0xffbe77);
          body.setSize(37,22,true).updateFromGameObject();
          this.coinSpark.emitParticleAt(sprite.x,y,5);
          sound(165,.18,105);
        } else if (piece.state===2) this.die(sprite.x);
        return;
      }
      if (type==='falling') {
        if (piece.state!==2) return;
        piece.state=3;
        sprite.disableBody(true,true);
        this.dust.emitParticleAt(sprite.x,sprite.y+9,9);
        this.die(sprite.x);
        return;
      }
      if (type==='boss' && this.clock<piece.timer) return;
      const canStomp = type==='enemy'||type==='hopper'||type==='boss';
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
      if (canStomp && playerBody.velocity.y>110 && playerBody.bottom < body.center.y+10) {
        this.player.setVelocityY(-385);
        sound(220,.15,110);
        if (type!=='boss' || ++piece.state>=GATEKEEPER_STOMPS) {
          sprite.disableBody(true,true);
          if (type==='boss') {
            this.gatekeeperDefeated=true;
            this.exitFlag.setVisible(true);
            this.say('Gatekeeper defeated. The real exit is ahead.');
          }
        } else {
          piece.direction = this.player.x<sprite.x ? 1 : -1;
          piece.timer=this.clock+560;
          sprite.setAlpha(.46);
        }
      } else this.die(sprite.x);
    }));
    return piece;
  }
  private syncCoinCount() {
    coins.hidden=this.collected.size===0;
    coins.textContent=`Coins ${this.collected.size}`;
  }
  private say(line: string) {
    caption.textContent = line;
    this.captionUntil = this.clock + 3450;
  }
  private syncHero(seconds = 0, grounded = false) {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = Math.abs(body.velocity.x);
    let pose = 'idle';
    if (!grounded) {
      pose = body.velocity.y < 55 ? 'rise' : 'fall';
    } else if (this.clock < this.landUntil) {
      pose = 'land';
    } else if (speed > 23) {
      this.stride += speed * seconds / 14;
      pose = `run-${Math.floor(this.stride) % 4}`;
    } else {
      this.stride = 0;
    }

    if (this.hero.frame.name !== pose) this.hero.setFrame(pose);
    const footY = body.bottom;
    const bob = grounded && speed > 24 ? Math.sin(this.stride * Math.PI) : 0;
    this.hero.setPosition(Math.round(this.player.x),Math.round(footY+bob));
    this.hero.setAngle(Phaser.Math.Linear(this.hero.angle,grounded ? 0 :
      Phaser.Math.Clamp(body.velocity.x / 45, -6, 6), Math.min(1,seconds*10)));
  }
  private die(sourceX?: number) {
    if (this.dead || this.paused) return;
    this.dead=true;
    this.touch.clear();
    this.lives--;
    this.physics.pause();

    const {hero}=this;
    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const away=(sourceX===undefined ? 0 : Math.sign(this.player.x-sourceX)) || (hero.flipX ? 1 : -1);
    const x=hero.x;
    const y=Math.min(hero.y,H-18);
    hero.setFrame('fall').setPosition(x,y).setTint(0xffbea0);
    this.dust.emitParticleAt(x,y,8);
    sound(208,.26,61);

    if (reducedMotion) {
      this.tweens.add({targets:hero,alpha:0,duration:280,onComplete:()=>this.retryAfterDeath()});
      return;
    }

    this.cameras.main.shake(120,.004);
    this.tweens.chain({targets:hero,tweens:[
      {x:x+away*16,y:y-33,angle:away*22,scaleX:.25,scaleY:.22,duration:105,ease:'Quad.Out'},
      {x:x+away*37,y:y+76,angle:away*105,alpha:.14,scaleX:.21,scaleY:.21,duration:285,ease:'Quad.In'},
    ],onComplete:()=>this.retryAfterDeath()});
  }
  private retryAfterDeath() {
    this.showLives(()=>this.loadLevel(this.index));
  }
  private showLives(resume: () => void) {
    this.physics.pause();
    livesCount.textContent=`× ${this.lives}`;
    livesAnnouncement.textContent=`${this.lives} ${Math.abs(this.lives)===1 ? 'life' : 'lives'}`;
    livesScreen.hidden=false;
    this.time.delayedCall(LIVES_SCREEN_MS,()=>{
      livesScreen.hidden=true;
      resume();
      if (this.touch.portrait && this.canPlay()) this.pauseGame();
    });
  }
  private start(index: number, freshRun = true) {
    this.onTitle = false;
    this.started = true;
    this.checkpoint = undefined;
    this.gatekeeperDefeated = false;
    if (freshRun) this.lives=STARTING_LIVES;
    this.collected.clear();
    this.paused = false;
    closeMenu();
    hud.hidden = false;
    this.loadLevel(index);
    this.showLives(()=>this.physics.resume());
    sound(385,.13,540);
  }
  private title() {
    this.onTitle = true;
    this.paused = true;
    hud.hidden = true;
    this.physics.pause();
    showMenu('Definitely Not a Trap!', 'The easiest game you’ll never finish.', [
      {title:this.started?'Continue':unlocked>0?'Continue Adventure':'Start Adventure',run:()=>this.started ? this.resumeGame() : this.start(unlocked)},
      {title:'Level Select',run:()=>this.select()},
      {title:muted?'Sound Off':'Sound On',run:()=>{ muted=!muted; saveProgress(); this.title(); }},
    ]);
  }
  private select() {
    const instructions=this.touch.enabled ? 'Use the side arrows to move and the up arrow to jump.' : 'Arrow keys or A / D to move. Space, W or ↑ to jump.';
    showMenu('Level Select',instructions, [
      ...levels.map((_, index)=>({title:levelLabel(index), run:()=>this.start(index), disabled:index>unlocked})),
      {title:'Back',run:()=>this.title()},
    ]);
  }
  private canPlay() {
    return !this.paused && !this.dead && !this.finishOpen && livesScreen.hidden;
  }
  private pauseGame() {
    this.touch.clear();
    this.paused=true;
    this.physics.pause();
    showMenu('Paused', `Coins ${this.collected.size}${this.touch.enabled?'':' · P to resume'}`,[
      {title:'Resume',run:()=>this.resumeGame()},
      {title:'Restart Level',run:()=>this.start(this.index)},
      {title:muted?'Sound Off':'Sound On',run:()=>{ muted=!muted; saveProgress(); this.pauseGame(); }},
      {title:'Main Menu',run:()=>{ this.started=false; this.title(); }},
    ]);
  }
  private resumeGame() {
    if (this.touch.portrait) return;
    this.paused=false;
    this.onTitle=false;
    hud.hidden=false;
    closeMenu();
    this.physics.resume();
  }
  private win() {
    this.touch.clear();
    this.finishOpen=true;
    this.paused=true;
    this.started=false;
    this.physics.pause();
    const last = this.index===levels.length-1;
    unlocked = Math.max(unlocked,Math.min(this.index+1,levels.length-1));
    saveProgress();
    if (this.index===4 && !last) {
      this.start(this.index+1,false);
      return;
    }
    sound(550,.24,880);
    showMenu(last?'Adventure Complete':`${levelLabel(this.index)} Clear`,`Coins ${this.collected.size}`,[
      {title:last?'Level Select':'Next Level',run:()=>last?this.select():this.start(this.index+1,false)},
      {title:'Play Again',run:()=>this.start(this.index,false)},
      {title:'Main Menu',run:()=>this.title()},
    ]);
  }
  private raiseSpikes(piece: Piece) {
    piece.state=2;
    piece.sprite.setVisible(true);
  }
  private drawTrapWarning(x: number,y: number) {
    this.draw.fillStyle(0xde6f43,.68).fillRect(x-21,y,42,3);
    this.draw.fillStyle(0xffd28e,.9).fillRect(x-3,y-11,6,8);
  }
  private updateEscapeGate(seconds: number) {
    const marker=levels[this.index].escapeGate;
    const gate=this.escapeGate;
    if (!marker || !gate) return;
    const body=this.player.body as Phaser.Physics.Arcade.Body;

    if (gate.startedAt===undefined && body.center.x>=marker.triggerX) {
      gate.startedAt=this.clock;
      this.say('The shutter is coming. Run and jump!');
      sound(210,.34,72);
    }

    const drop=gate.startedAt===undefined ? 0 : Math.min(1,(this.clock-gate.startedAt)/GATE_DROP_MS);
    if (drop===1) gate.x+=GATE_SPEED*seconds;

    const x=Math.round(gate.x);
    const teethY=marker.y-115+Math.round(drop*115);
    const top=marker.y-154;
    const plate=gate.startedAt===undefined ? 0xf2be61 : 0xef6551;
    this.draw.fillStyle(0x362522).fillRect(marker.triggerX-14,marker.y-4,28,4);
    this.draw.fillStyle(plate).fillRect(marker.triggerX-11,marker.y-5,22,3);
    this.draw.fillStyle(0x34251f).fillRect(x-16,top-8,32,12);
    for (let bar=x-12;bar<=x+12;bar+=8) {
      this.draw.fillStyle(0x9a5b3e).fillRect(bar-2,top,5,teethY-top-6);
      this.draw.fillStyle(0xffc278).fillRect(bar-1,top,1,teethY-top-6);
      this.draw.fillStyle(0xb9794c).fillTriangle(bar-3,teethY-7,bar+3,teethY-7,bar,teethY);
    }
    this.draw.fillStyle(0x6a4232).fillRect(x-15,teethY-17,30,7);
    this.draw.fillStyle(plate).fillRect(x-3,teethY-15,6,3);

    if (drop===1 && body.left<=gate.x+15) this.die(gate.x);
  }
  private tickPiece(piece: Piece, seconds: number) {
    const {type,sprite,x,y,range} = piece;
    const distance = this.player.x-x;
    if (!sprite.active) return;
    if (type==='bridge' && piece.state===1) {
      sprite.setAngle(Math.round(Math.sin(this.clock/23)*3));
      if (this.clock>=piece.timer) {
        piece.state=2;
        this.dust.emitParticleAt(sprite.x, sprite.y-8, 5);
        (sprite.body as Phaser.Physics.Arcade.Body).checkCollision.none=true;
        sprite.setImmovable(false).setVelocity(20,155).setGravityY(600);
        this.tweens.add({targets:sprite,angle:38,duration:350});
      }
    }
    if (type==='bridge' && piece.state===2 && sprite.y>H+90) sprite.disableBody(true,true);
    if (type==='bait' && piece.state===1 && this.clock>=piece.timer) {
      piece.state=2;
      sprite.clearTint();
    }
    if (type==='spikes' || type==='jumpSpikes') {
      const body=this.player.body as Phaser.Physics.Arcade.Body;
      const inLane=body.bottom>=y-sprite.height && body.top<y;
      const activates=type==='jumpSpikes' ? body.velocity.y < -10 : inLane;
      if (piece.state===0 && activates && Math.abs(distance)<=SPIKE_TRIGGER_RANGE) {
        piece.state=1;
        piece.timer=this.clock+piece.warningMs;
        if (type==='jumpSpikes') this.say('Your jump armed the spikes.');
        sound(120,.13,78);
      }
      if (type==='jumpSpikes' && piece.state>0 && this.clock<piece.timer+650) {
        this.draw.fillStyle(0xa9442e,.9).fillRect(x-29,y-2,58,5);
        this.draw.fillStyle(0xffc875).fillRect(x-27,y-3,54,2);
      }
      if (piece.state===1) {
        this.drawTrapWarning(x,y-1);
        if (this.clock>=piece.timer) {
          this.raiseSpikes(piece);
          if (type==='jumpSpikes') this.dust.emitParticleAt(x,y-4,8);
        }
      }
    }
    if (type==='falling') {
      if (piece.state===0 && Math.abs(distance)<=ROCK_TRIGGER_RANGE) {
        piece.state=1;
        piece.timer=this.clock+ROCK_WARNING_MS;
        sound(120,.13,78);
      }
      if (piece.state===1) {
        this.drawTrapWarning(x,y-3);
        if (this.clock>=piece.timer) {
          piece.state=2;
          sprite.enableBody(true,x,32,true,true);
          (sprite.body as Phaser.Physics.Arcade.Body).setAllowGravity(true);
          sprite.setMaxVelocity(0,1800).setVelocityY(1120).setGravityY(2250);
          piece.timer=this.clock+1120;
        }
      }
      if (piece.state===2) {
        const width=36+Phaser.Math.Clamp(sprite.y/y,0,1)*18;
        this.draw.fillStyle(0x392627,.45).fillEllipse(x,y-2,width,9);
        if (this.clock>piece.timer || sprite.y+sprite.height/2>=y) {
          this.dust.emitParticleAt(x,y,8);
          sound(103,.16,58);
          piece.state=3;
          sprite.disableBody(true,true);
        }
      }
    }
    if (type==='enemy'||type==='hopper'||type==='flyer'||(type==='boss'&&sprite.visible)) {
      const boss = type==='boss';
      if (boss && this.clock<piece.timer) return;
      if (boss) sprite.setAlpha(1);
      const speed = boss ? 112 + piece.state*19 : type==='flyer'?92:67;
      let nextX = sprite.x+piece.direction*speed*seconds;
      if (Math.abs(nextX-x)>range) {
        nextX=x+Math.sign(nextX-x)*range;
        piece.direction *= -1;
      }
      const base = type==='flyer'?y:y-sprite.height/2;
      const bounce = type==='hopper'?Math.abs(Math.sin(this.clock/430))*35:type==='flyer'?Math.sin(this.clock/360)*10:0;
      sprite.setPosition(nextX,base-bounce).setFlipX(piece.direction<0);
      (sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
    }
    if (type==='chase') {
      if (range && distance>=range) {
        sprite.disableBody(true,true);
        return;
      }
      if (piece.state===0 && distance>40) {
        piece.state=1;
        (sprite.body as Phaser.Physics.Arcade.Body).reset(this.player.x-220,y-24);
        sprite.setVisible(true);
        sound(124,.22,60);
      }
      if (piece.state===1) {
        (sprite.body as Phaser.Physics.Arcade.Body).reset(sprite.x+224*seconds,sprite.y);
      }
    }
    if (type==='fakeExit' && piece.state===0 && Math.abs(distance)<39) {
      piece.state=1;
      sprite.setVisible(false);
      this.say('That flag was bait! Jump on the gatekeeper three times to open the real exit.');
      const boss = this.pieces.find(item=>item.type==='boss');
      if (boss) boss.sprite.setPosition(boss.x,boss.y-boss.sprite.height/2).setVisible(true);
      sound(310,.21,75);
    }
  }
  update(_time: number,delta: number) {
    if (!this.player || !this.canPlay() || this.touch.portrait) return;
    this.clock+=delta;
    const seconds=Math.min(delta,48)/1000;
    const k=this.keys;
    const left=k.LEFT.isDown||k.A.isDown||this.touch.down('left');
    const right=k.RIGHT.isDown||k.D.isDown||this.touch.down('right');
    const direction=Number(right)-Number(left);
    const body=this.player.body as Phaser.Physics.Arcade.Body;
    const floor=(body.blocked.down||body.touching.down) && body.velocity.y>=0;
    if (floor) {
      this.lastGround=this.clock;
      if (!this.wasGrounded && this.fallSpeed>165) {
        this.landUntil=this.clock+(this.fallSpeed>430?105:65);
        this.dust.emitParticleAt(this.player.x,body.bottom, this.fallSpeed>430 ? 7 : 3);
        sound(145,.075,96);
      }
    }
    const pressingJump=k.SPACE.isDown||k.UP.isDown||k.W.isDown||this.touch.down('jump');
    const keyboardJump=[k.SPACE,k.UP,k.W].map(key=>Phaser.Input.Keyboard.JustDown(key)).some(Boolean);
    const jumpBuffer=this.touch.consumeJump() ? TOUCH_JUMP_BUFFER_MS : keyboardJump ? KEYBOARD_JUMP_BUFFER_MS : 0;
    if (jumpBuffer) {
      this.jumpBufferedUntil=Math.max(this.jumpBufferedUntil,this.clock+jumpBuffer);
    }
    const launched=this.clock<this.jumpBufferedUntil && this.clock-this.lastGround<96;
    if (launched) {
      this.player.setVelocityY(pressingJump ? -498 : -365);
      this.lastGround=-1000;
      this.jumpBufferedUntil=0;
      this.landUntil=0;
      if (floor) this.dust.emitParticleAt(this.player.x,body.bottom,4);
      sound(305,.15,450);
    } else if (!pressingJump && this.jumpHeld && body.velocity.y < -220) {
      this.player.setVelocityY(-220);
    }
    this.jumpHeld=pressingJump;
    this.wasGrounded=floor&&!launched;
    this.fallSpeed=Math.max(0,body.velocity.y);
    body.setGravityY(body.velocity.y>0 ? 390 : 0);

    const speed=body.velocity.x;
    const reversing=direction!==0 && Math.sign(speed)!==direction;
    const acceleration=floor ? (direction ? reversing ? 3250 : 2360 : 3100) : direction ? 1390 : 265;
    const targetSpeed=direction*248;
    const adjustment=Phaser.Math.Clamp(targetSpeed-speed,-acceleration*seconds,acceleration*seconds);
    this.player.setVelocityX(speed+adjustment);
    if (reversing && floor && Math.abs(speed)>175 && Math.abs(speed+adjustment)<=175) {
      this.dust.emitParticleAt(this.player.x,body.bottom,4);
    }
    if (Math.abs(body.velocity.x)>26) this.hero.setFlipX(body.velocity.x<0);
    if (this.player.x<14) this.player.setX(14).setVelocityX(0);
    this.syncHero(seconds,this.wasGrounded);
    if (this.player.y>H+46) { this.die(); return; }
    const map=levels[this.index];
    this.scaleCamera=Phaser.Math.Linear(this.scaleCamera,this.scrollTarget(this.player.x),Math.min(1,seconds*8));
    this.positionCamera();
    if (floor) {
      const marker=map.checkpoints.find(x=>x>(this.checkpoint ?? -1) &&
        this.player.x>=x && this.player.x<x+57 && Math.abs(body.bottom-this.groundAt(x))<=3);
      if (marker!==undefined) {
        this.checkpoint=marker;
        sound(525,.16,760);
      }
    }
    if (this.captionUntil && this.clock>this.captionUntil) {
      this.captionUntil=0;
      caption.textContent='';
    }
    map.lines.forEach(([x,line],i)=>{
      if (this.player.x>=x && this.player.x<x+70 && !this.lines.has(i)) {
        this.lines.add(i);
        this.say(line);
      }
    });
    this.draw.clear();
    if (this.index===0 && this.player.x>=594 && this.landingArt.length) {
      this.landingArt.forEach(object=>object.setVisible(true));
      this.landingArt=[];
    }
    this.pieces.forEach(piece=>this.tickPiece(piece,seconds));
    this.updateRails();
    this.updateEscapeGate(seconds);
    if (this.dead) return;
    const boss=this.pieces.find(piece=>piece.type==='boss');
    if (boss?.sprite.active && boss.sprite.visible) {
      const x=Math.round(boss.sprite.x)-15;
      const y=Math.round(boss.sprite.y-boss.sprite.height/2)-13;
      this.draw.fillStyle(0x39262f).fillRect(x-2,y-2,34,10);
      for (let i=0;i<GATEKEEPER_STOMPS;i++) {
        this.draw.fillStyle(i<GATEKEEPER_STOMPS-boss.state?0xffce7a:0x73525b).fillRect(x+i*11,y,8,6);
      }
    }
    if (this.player.x>=map.exit-12 && this.player.y>215 && (!boss||!boss.sprite.active)) this.win();
  }
}

const game = new Phaser.Game({
  type:Phaser.AUTO,
  parent:'stage',
  width:W,
  height:H,
  backgroundColor:'#6ba7ef',
  pixelArt:true,
  roundPixels:true,
  scale:{mode:Phaser.Scale.RESIZE},
  physics:{default:'arcade',arcade:{gravity:{x:0,y:1080}}},
  scene:Adventure,
});

const screen = document.querySelector<HTMLElement>('#screen')!;
screen.addEventListener('click', () => {
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    void screen.requestFullscreen().catch(() => {
      // Embedded browsers can deny the request; the viewport layout still fills the window.
    });
  }
}, {capture:true,once:true});

document.addEventListener('fullscreenchange', () => {
  requestAnimationFrame(() => game.scale.refresh());
});

if (import.meta.env.DEV) Object.assign(window, { trapGame: game });
