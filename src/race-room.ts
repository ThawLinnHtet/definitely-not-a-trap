import Peer, { type DataConnection } from 'peerjs';

const ROOM_LIMIT = 8;
const START_DELAY = 3000;
const CONNECTION_TIMEOUT = 15000;
const ROOM_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const INVITE_SECRET = /^[0-9a-f]{32}$/;

type Phase = 'connecting' | 'lobby' | 'countdown' | 'racing' | 'finished' | 'error';
type Member = { connection: DataConnection; number: number };
type Invite = { room: string; secret: string };

function readInvite(hash: string): Invite | undefined {
  const [room, secret] = new URLSearchParams(hash.slice(1)).get('race')?.split('.') ?? [];
  if (ROOM_ID.test(room) && INVITE_SECRET.test(secret)) return { room, secret };
}

function message(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
}

export class RaceRoom {
  static readonly hasInvite = () => new URLSearchParams(location.hash.slice(1)).has('race');

  readonly isHost: boolean;
  readonly link?: string;
  phase: Phase = 'connecting';
  players = 1;
  player = 1;
  winner?: number;
  error = '';
  level: number;
  submitted = false;

  private readonly peer?: Peer;
  private readonly members = new Map<string, Member>();
  private host?: DataConnection;
  private nextNumber = 2;
  private startTimer?: number;
  private connectTimer?: number;
  private openedAt = 0;
  private clockOffset = 0;
  private closed = false;

  constructor(
    level: number | undefined,
    private readonly levelCount: number,
    private readonly changed: () => void,
  ) {
    this.isHost = level !== undefined;
    this.level = level ?? 0;
    const invite = this.isHost
      ? { room: crypto.randomUUID(), secret: crypto.randomUUID().replaceAll('-', '') }
      : readInvite(location.hash);
    if (!invite) {
      this.phase = 'error';
      this.error = 'This invite link is invalid.';
      return;
    }

    if (this.isHost) {
      const url = new URL(location.href);
      url.hash = 'race=' + invite.room + '.' + invite.secret;
      this.link = url.href;
    }
    this.peer = this.isHost ? new Peer(invite.room) : new Peer();
    this.connectTimer = window.setTimeout(() => this.fail('Could not connect. Check the invite and try again.'), CONNECTION_TIMEOUT);

    this.peer.on('open', () => {
      if (this.isHost) {
        this.openLobby();
      } else {
        const host = this.peer!.connect(invite.room, {
          reliable: true,
          serialization: 'json',
          metadata: invite.secret,
        });
        this.host = host;
        host.on('open', () => {
          this.openedAt = Date.now();
          void host.send({ type: 'hello' });
        });
        host.on('data', data => this.receiveFromHost(data));
        host.on('close', () => this.fail('The host left the room.'));
        host.on('error', () => this.fail('The connection to the host was lost.'));
      }
    });
    this.peer.on('connection', connection => {
      if (this.isHost && connection.metadata === invite.secret) this.accept(connection);
      else connection.on('open', () => connection.close());
    });
    this.peer.on('error', () => {
      if (this.phase === 'connecting') this.fail('Could not connect. Check the invite and try again.');
    });
  }

  private openLobby() {
    window.clearTimeout(this.connectTimer);
    this.phase = 'lobby';
    this.changed();
  }

  private accept(connection: DataConnection) {
    connection.on('data', data => {
      const { type } = message(data);
      if (type === 'hello' && !this.members.has(connection.peer)) {
        if (this.phase !== 'lobby' || this.players >= ROOM_LIMIT) {
          void connection.send({ type: 'unavailable' });
          return;
        }
        const member = { connection, number: this.nextNumber++ };
        this.members.set(connection.peer, member);
        void connection.send({ type: 'welcome', level: this.level, player: member.number, time: Date.now() });
        this.updateRoster();
      }
      if (type === 'finish' && this.phase === 'racing') {
        const member = this.members.get(connection.peer);
        if (member) this.declareWinner(member.number);
      }
    });
    connection.on('close', () => {
      if (this.members.delete(connection.peer) && this.phase === 'lobby') this.updateRoster();
    });
  }

  private updateRoster() {
    this.players = this.members.size + 1;
    this.broadcast({ type: 'roster', players: this.players });
    this.changed();
  }

  private receiveFromHost(data: unknown) {
    const { type, level, player, time, players, startsAt, winner } = message(data);
    if (type === 'welcome' && this.phase === 'connecting' &&
      typeof level === 'number' && Number.isInteger(level) && level >= 0 && level < this.levelCount &&
      typeof player === 'number' && Number.isInteger(player) && player >= 2 &&
      typeof time === 'number' && Number.isFinite(time)) {
      this.level = level;
      this.player = player;
      this.clockOffset = time - (this.openedAt + Date.now()) / 2;
      this.openLobby();
    }
    if (type === 'unavailable' && this.phase === 'connecting') this.fail('This room is full or its race already started.');
    if (type === 'roster' && this.phase === 'lobby' &&
      typeof players === 'number' && Number.isInteger(players) && players >= 1 && players <= ROOM_LIMIT) {
      this.players = players;
      this.changed();
    }
    if (type === 'start' && this.phase === 'lobby' && typeof startsAt === 'number' && Number.isFinite(startsAt)) {
      this.countDown(Math.max(0, Math.min(START_DELAY, startsAt - this.clockOffset - Date.now())));
    }
    if (type === 'winner' && (this.phase === 'countdown' || this.phase === 'racing') &&
      typeof winner === 'number' && Number.isInteger(winner) && winner >= 1) this.recordWinner(winner);
  }

  start() {
    if (!this.isHost || this.phase !== 'lobby' || this.players < 2) return;
    this.broadcast({ type: 'start', startsAt: Date.now() + START_DELAY });
    this.countDown(START_DELAY);
  }

  private countDown(delay: number) {
    this.phase = 'countdown';
    this.changed();
    this.startTimer = window.setTimeout(() => {
      this.phase = 'racing';
      this.changed();
    }, delay);
  }

  finish() {
    if (this.phase !== 'racing' || this.submitted) return;
    this.submitted = true;
    if (this.isHost) this.declareWinner(1);
    else {
      void this.host?.send({ type: 'finish' });
      this.changed();
    }
  }

  private declareWinner(winner: number) {
    this.broadcast({ type: 'winner', winner });
    this.recordWinner(winner);
  }

  private recordWinner(winner: number) {
    window.clearTimeout(this.startTimer);
    this.winner = winner;
    this.phase = 'finished';
    this.changed();
  }

  private broadcast(data: Record<string, unknown>) {
    for (const { connection } of this.members.values()) {
      if (connection.open) void connection.send(data);
    }
  }

  private fail(error: string) {
    if (this.closed || this.phase === 'finished') return;
    this.phase = 'error';
    this.error = error;
    this.close();
    this.changed();
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.connectTimer);
    window.clearTimeout(this.startTimer);
    this.peer?.destroy();
    this.members.clear();
  }
}
