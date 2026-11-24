import Phaser from 'phaser';
import '@fontsource/pixelify-sans/latin-400.css';
import '@fontsource/pixelify-sans/latin-700.css';
import './style.css';
import { levels, type Kind } from './levels';

const W = 836;
const H = 470;
const saveKey = 'definitely-not-a-trap-progress';
const hud = document.querySelector<HTMLElement>('#hud')!;
const label = document.querySelector<HTMLElement>('#level')!;
const caption = document.querySelector<HTMLElement>('#caption')!;
const overlay = document.querySelector<HTMLElement>('#overlay')!;
const menu = document.querySelector<HTMLElement>('#menu')!;
type Sprite = Phaser.Physics.Arcade.Image;
type Piece = { type: Kind; sprite: Sprite; x: number; y: number; range: number; timer: number; direction: number; state: number };
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
  private checkpoint = false;
  private deaths = 0;
  private collected = new Set<number>();
  private paused = true;
  private dead = false;
  private onTitle = true;
  private started = false;
  private finishOpen = false;
  private lastGround = -1000;
  private jumpPressed = -1000;
  private captionUntil = 0;
  private clock = 0;
  private scaleCamera = 0;
  private player!: Sprite;
  private hero!: Phaser.GameObjects.Image;
  private backdrop!: Phaser.GameObjects.Image;
  private terrain!: Phaser.Physics.Arcade.StaticGroup;
  private draw!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private pieces: Piece[] = [];
  private lines = new Set<number>();
  private actors: Phaser.GameObjects.GameObject[] = [];
  private landingArt: Phaser.GameObjects.Components.Visible[] = [];
  private colliders: Phaser.Physics.Arcade.Collider[] = [];

  constructor() { super('adventure'); }
  preload() {
    this.load.image('landscape', '/art/grassland.png');
    this.load.image('adventurer', '/art/adventurer.png');
  }
  create() {
    this.makeTextures();
    this.draw = this.add.graphics().setDepth(6);
    this.keys = this.input.keyboard!.addKeys('LEFT,RIGHT,UP,A,D,W,SPACE,ESC,R') as typeof this.keys;
    this.input.keyboard!.on('keydown-ESC', (event: KeyboardEvent) => {
      event.preventDefault();
      if (this.onTitle || this.dead || this.finishOpen) return;
      if (this.paused) this.resumeGame(); else this.pauseGame();
    });
    this.input.keyboard!.on('keydown-R', () => {
      if (!this.paused && !this.dead && !this.finishOpen) this.die();
    });
    this.game.events.on(Phaser.Core.Events.BLUR, () => {
      if (!this.paused && !this.dead && !this.finishOpen) this.pauseGame();
    });
    this.loadLevel(0);
    this.title();
  }
  private makeTextures() {
    const g = this.make.graphics({x:0,y:0}, false);
    const texture = (name: string, w: number, h: number, paint: () => void) => {
      g.clear(); paint(); g.generateTexture(name,w,h);
    };
    const fill = (color: number,x: number,y: number,w: number,h: number) => g.fillStyle(color).fillRect(x,y,w,h);
    texture('body',30,51,()=>fill(0xffffff,0,0,30,51));
    texture('plank',50,19,()=>{
      fill(0x432820,0,2,50,17); fill(0x825334,2,5,46,11); fill(0xc58e50,1,1,47,5);
      fill(0xe7b579,3,0,45,2); fill(0x583729,7,9,30,2); fill(0xb4a187,6,8,3,4);
      fill(0xb4a187,42,8,3,4);
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
      fill(0x403b43,4,7,29,27); fill(0x695862,0,13,37,15);
      fill(0x8b7975,7,4,22,26); fill(0xb0a18c,8,7,12,6); fill(0x64535a,20,19,8,9);
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
    this.index = index;
    const map = levels[index];
    for (const collider of this.colliders) collider.destroy();
    this.colliders = [];
    this.terrain?.destroy(true);
    this.actors.forEach(object => object.destroy());
    this.actors = [];
    this.landingArt = [];
    this.pieces = [];
    this.lines.clear();
    this.dead = false;
    this.finishOpen = false;
    this.lastGround = -1000;
    this.jumpPressed = -1000;
    this.clock = 0;
    this.captionUntil = 0;
    this.scaleCamera = 0;
    caption.textContent = '';
    label.textContent = map.name;
    this.cameras.main.setScroll(0,0);
    this.draw.clear();
    this.backdrop = this.track(this.add.image(0,0,'landscape').setOrigin(0).setDisplaySize(W,H).setScrollFactor(0).setDepth(-5).setTint(map.tint));
    if (index > 0) {
      this.backdrop.setCrop(0,0,this.backdrop.width,Math.floor(this.backdrop.height * .55));
      this.track(this.add.rectangle(0,253,W,220,0x384a48).setOrigin(0).setScrollFactor(0).setDepth(-6));
    }
    this.terrain = this.physics.add.staticGroup();
    for (const [x,y,w] of map.surfaces) {
      const floor = this.terrain.create(x+w/2,y+18,'body') as Phaser.Physics.Arcade.Image;
      floor.setDisplaySize(w,36).setVisible(false).refreshBody();
      if (index > 0) this.paintTerrain(x,y,w,map.tint);
      if (index === 0 && y < 300) {
        const ledge = this.track(this.add.graphics().setDepth(1).setVisible(false));
        ledge.fillStyle(0x624735).fillRect(x,y,w,13);
        ledge.fillStyle(0xc18e56).fillRect(x+3,y+4,w-6,6);
        ledge.fillStyle(0x859037).fillRect(x,y,w,4);
        ledge.fillStyle(0xb7b54b).fillRect(x+2,y,w-4,2);
        this.landingArt.push(ledge);
      }
    }
    this.player = this.track(this.physics.add.image(this.checkpoint ? map.checkpoint : map.start,
      (index === 0 ? 306 : 333)-28,'body')).setVisible(false).setMaxVelocity(248,720);
    this.hero = this.track(this.add.image(0,0,'adventurer').setDepth(8));
    this.hero.setDisplaySize(165,110);
    this.syncHero();
    this.colliders.push(this.physics.add.collider(this.player,this.terrain));
    if (index === 0) {
      const supports = this.track(this.add.graphics().setDepth(2));
      for (const [x, direction] of [[169,1],[611,-1]]) {
        supports.fillStyle(0x4a2a24).fillRect(x-8,307,16,125);
        supports.fillStyle(0x865131).fillRect(x-5,310,9,114);
        supports.lineStyle(12,0x593528).beginPath().moveTo(x,368).lineTo(x+direction*45,315).strokePath();
        supports.fillStyle(0x9c6440).fillRect(x-9,290,18,10);
        supports.fillStyle(0x553526).fillRect(x-11,299,22,6);
        supports.fillStyle(0xc19458).fillRect(x-10,303,20,3).fillRect(x-10,341,20,4);
      }
      for (let x=146;x<620;x+=49) this.spawn('bridge',x+24,306);
    }
    map.objects.forEach(([type,x,y,range],i) => {
      if (type !== 'coin' || !this.collected.has(i)) this.spawn(type,x,y,range,i);
    });
    const exit = this.track(this.add.image(map.exit, (index === 0 ? 306 : 333),'exit').setOrigin(.5,1).setDepth(4));
    if (index === 0) {
      this.landingArt.push(exit, ...this.pieces.filter(piece=>piece.type!=='bridge').map(piece=>piece.sprite));
      this.landingArt.forEach(object=>object.setVisible(false));
    }
    if (index > 0) this.track(this.add.image(map.checkpoint,(index===1?337:333),'exit').setOrigin(.5,1).setDepth(4).setTint(0xe7ac70).setScale(.66));
    if (this.checkpoint && index > 0) {
      const shift = Math.max(0, map.checkpoint - 370);
      this.cameras.main.setScroll(shift,0);
      this.scaleCamera = shift;
    }
    if (this.paused) this.physics.pause(); else this.physics.resume();
  }
  private paintTerrain(x: number,y: number,w: number,tint: number) {
    const graphics = this.track(this.add.graphics().setDepth(1));
    graphics.fillStyle(0x4e382d).fillRect(x, y+4, w, 145);
    graphics.fillStyle(0x97683e).fillRect(x+3, y+9, w-6, 132);
    for (let dx=5;dx<w-6;dx+=12) {
      const height = 10 + ((dx*17+x) % 20);
      graphics.fillStyle(dx%5 ? 0xb6804c : 0x694b35).fillRect(x+dx,y+21+(dx%28),Math.min(8,w-dx-2),height);
    }
    const shades = tint===0xc2b9e9 ? [0x7774a4,0xb8adda] : tint===0xe4a6a0 ? [0x805447,0xc28662] : [0x617b30,0xa7ad42];
    graphics.fillStyle(shades[0]).fillRect(x,y,w,11);
    graphics.fillStyle(shades[1]).fillRect(x,y,w,4);
    for (let dx=5;dx<w-4;dx+=7) graphics.fillStyle(shades[0]).fillRect(x+dx,y+8,4,5+(dx%4));
  }
  private spawn(type: Kind,x: number,y: number,range=0,id=-1) {
    const texture = type==='bridge' ? 'plank' : type==='bait' ? 'coin' : type==='falling' ? 'rock' : type==='spikes' ? 'spike' : type==='fakeExit' ? 'exit' : type;
    const sprite = this.track(this.physics.add.image(x,y,texture)).setDepth(4);
    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    sprite.setImmovable();
    const piece: Piece = {type,sprite,x,y,range,timer:0,direction:1,state:0};
    this.pieces.push(piece);
    if (type==='bridge') {
      sprite.setY(y+sprite.height/2).setDepth(3);
      body.updateFromGameObject();
      this.colliders.push(this.physics.add.collider(this.player,sprite,()=>{
        if (piece.state===0) { piece.state=1; piece.timer=this.clock+590; sound(112,.09,80); }
      },()=>piece.state<2));
      return;
    }
    if (type==='spikes' || type==='falling' || type==='chase' || type==='boss') sprite.setVisible(false);
    else if (type!=='coin' && type!=='bait' && type!=='flyer') sprite.setY(y-sprite.height/2);
    body.updateFromGameObject();
    if (type==='fakeExit') return;
    this.colliders.push(this.physics.add.overlap(this.player,sprite,()=>{
      if (this.dead || !sprite.visible) return;
      if (type==='coin' || type==='bait') {
        if (type==='coin') {
          this.collected.add(id);
          sprite.disableBody(true,true);
          sound(690,.12,990);
        } else if (piece.state===0) {
          piece.state=1;
          piece.timer=this.clock+525;
          sprite.setTexture('spike').setY(y+15).setTint(0xffbe77);
          body.setSize(37,22,true);
          sound(165,.18,105);
        } else if (piece.state===2) this.die();
        return;
      }
      if ((type==='spikes'||type==='falling') && piece.state!==2) return;
      const canStomp = type==='enemy'||type==='hopper'||type==='boss';
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
      if (canStomp && playerBody.velocity.y>110 && playerBody.bottom < body.center.y+10) {
        this.player.setVelocityY(-385);
        sound(220,.15,110);
        if (type!=='boss' || ++piece.state>=3) {
          sprite.disableBody(true,true);
          if (type==='boss') this.say('Fine. That one is the real exit.');
        } else {
          piece.direction = this.player.x<sprite.x ? 1 : -1;
          piece.timer=this.clock+560;
          sprite.setAlpha(.46);
        }
      } else if (this.clock>=piece.timer || type!=='boss') this.die();
    }));
  }
  private say(line: string) {
    caption.textContent = line;
    this.captionUntil = this.clock + 3450;
  }
  private syncHero() {
    const running = Math.abs(this.player.body?.velocity.x ?? 0)>40;
    const grounded = (this.player.body as Phaser.Physics.Arcade.Body).blocked.down || (this.player.body as Phaser.Physics.Arcade.Body).touching.down;
    const bob = grounded && running ? Math.round(Math.sin(this.clock/28)*2) : 0;
    this.hero.setPosition(Math.round(this.player.x)+(this.hero.flipX?12:-12),Math.round(this.player.y)-17+bob);
    this.hero.setAngle(grounded && running ? Math.round(Math.sin(this.clock/32)*3) : 0);
  }
  private die() {
    if (this.dead || this.paused) return;
    this.dead = true;
    this.deaths++;
    this.hero.setTint(0xffa38a);
    this.physics.pause();
    sound(208,.26,61);
    this.time.delayedCall(420,()=>this.loadLevel(this.index));
  }
  private start(index: number) {
    this.onTitle = false;
    this.started = true;
    this.checkpoint = false;
    this.deaths = 0;
    this.collected.clear();
    this.paused = false;
    closeMenu();
    hud.hidden = false;
    this.loadLevel(index);
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
    showMenu('Level Select','Arrow keys or A / D to move. Space, W or ↑ to jump.', [
      ...levels.map((level,i)=>({title:level.name, run:()=>this.start(i), disabled:i>unlocked})),
      {title:'Back',run:()=>this.title()},
    ]);
  }
  private pauseGame() {
    this.paused=true;
    this.physics.pause();
    showMenu('Paused', `Deaths ${this.deaths} · Coins ${this.collected.size} · Esc to resume`,[
      {title:'Resume',run:()=>this.resumeGame()},
      {title:'Restart Level',run:()=>this.start(this.index)},
      {title:muted?'Sound Off':'Sound On',run:()=>{ muted=!muted; saveProgress(); this.pauseGame(); }},
      {title:'Main Menu',run:()=>{ this.started=false; this.title(); }},
    ]);
  }
  private resumeGame() {
    this.paused=false;
    this.onTitle=false;
    hud.hidden=false;
    closeMenu();
    this.physics.resume();
  }
  private win() {
    this.finishOpen=true;
    this.paused=true;
    this.started=false;
    this.physics.pause();
    const last = this.index===levels.length-1;
    unlocked = Math.max(unlocked,Math.min(this.index+1,levels.length-1));
    saveProgress();
    sound(550,.24,880);
    showMenu(last?'Adventure Complete':`${levels[this.index].name} Clear`,`Deaths ${this.deaths} · Coins ${this.collected.size}`,[
      {title:last?'Level Select':'Next Level',run:()=>last?this.select():this.start(this.index+1)},
      {title:'Play Again',run:()=>this.start(this.index)},
      {title:'Main Menu',run:()=>this.title()},
    ]);
  }
  private tickPiece(piece: Piece, seconds: number) {
    const {type,sprite,x,y,range} = piece;
    const distance = this.player.x-x;
    if (!sprite.active) return;
    if (type==='bridge' && piece.state===1) {
      sprite.setAngle(Math.round(Math.sin(this.clock/23)*3));
      if (this.clock>=piece.timer) {
        piece.state=2;
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
    if (type==='spikes'||type==='falling') {
      if (piece.state===0 && distance>-125 && distance<48) {
        piece.state=1;
        piece.timer=this.clock+665;
        sound(120,.13,78);
      }
      if (piece.state===1) {
        const alertY=type==='falling'? y-3 : y-1;
        this.draw.fillStyle(0xde6f43,.68).fillRect(x-21,alertY,42,3);
        this.draw.fillStyle(0xffd28e,.9).fillRect(x-3,alertY-11,6,8);
        if (this.clock>=piece.timer) {
          piece.state=2;
          sprite.enableBody(true,x,type==='falling'?45:y-12,true,true);
          if (type==='falling') sprite.setVelocityY(515);
          piece.timer=this.clock+1120;
        }
      }
      if (piece.state===2 && this.clock>piece.timer) {
        piece.state=3;
        sprite.disableBody(true,true);
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
      if (piece.state===0 && distance>40) {
        piece.state=1;
        sprite.setPosition(this.player.x-220,y-24).setVisible(true);
        sound(124,.22,60);
      }
      if (piece.state===1) {
        sprite.setX(sprite.x + 192*seconds);
        (sprite.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
      }
    }
    if (type==='fakeExit' && piece.state===0 && Math.abs(distance)<39 && this.player.y>y-90) {
      piece.state=1;
      sprite.setVisible(false);
      this.say('Congratulations! Your prize is behind you. Kidding.');
      const boss = this.pieces.find(item=>item.type==='boss');
      if (boss) boss.sprite.setPosition(boss.x,boss.y-boss.sprite.height/2).setVisible(true);
      sound(310,.21,75);
    }
  }
  update(_time: number,delta: number) {
    if (!this.player || this.paused || this.dead || this.finishOpen) return;
    this.clock+=delta;
    const seconds=Math.min(delta,48)/1000;
    const k=this.keys;
    const left=k.LEFT.isDown||k.A.isDown;
    const right=k.RIGHT.isDown||k.D.isDown;
    const direction=Number(right)-Number(left);
    const body=this.player.body as Phaser.Physics.Arcade.Body;
    const floor=body.blocked.down||body.touching.down;
    if (floor) this.lastGround=this.clock;
    const pressed=[k.SPACE,k.UP,k.W].map(key=>Phaser.Input.Keyboard.JustDown(key)).some(Boolean);
    if (pressed) this.jumpPressed=this.clock;
    if (this.clock-this.jumpPressed<130 && this.clock-this.lastGround<100) {
      this.player.setVelocityY(-473);
      this.lastGround=-1000;
      this.jumpPressed=-1000;
      sound(325,.13,520);
    }
    const jumping=k.SPACE.isDown||k.UP.isDown||k.W.isDown;
    if (!jumping && body.velocity.y < -245) this.player.setVelocityY(-245);
    this.player.setVelocityX(Phaser.Math.Linear(body.velocity.x,direction*248,Math.min(1,seconds*(direction?17:25))));
    if (direction) this.hero.setFlipX(direction<0);
    if (this.player.x<14) this.player.setX(14).setVelocityX(0);
    this.syncHero();
    if (this.player.y>H+46) { this.die(); return; }
    const map=levels[this.index];
    const startScroll=this.index===0?705:424;
    const maxScroll=Math.max(0,map.exit+82-W);
    const scroll=this.index===0 ? 0 : Phaser.Math.Clamp(this.player.x-startScroll,0,maxScroll);
    this.scaleCamera=Phaser.Math.Linear(this.scaleCamera,scroll,Math.min(1,seconds*8));
    this.cameras.main.setScroll(Math.round(this.scaleCamera),0);
    if (floor && this.player.x>=map.checkpoint && this.player.x<map.checkpoint+57 && !this.checkpoint) {
      this.checkpoint=true;
      sound(525,.16,760);
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
    const boss=this.pieces.find(piece=>piece.type==='boss');
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
  scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},
  physics:{default:'arcade',arcade:{gravity:{x:0,y:1080}}},
  scene:Adventure,
});

if (import.meta.env.DEV) Object.assign(window, { trapGame: game });
