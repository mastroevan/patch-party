import Phaser from "phaser";
import { modifiers, advanceEffect } from "./mechanics";
import type { PartyState, Action } from "../contracts";
export interface ArenaBridge {
  get: () => {
    state: PartyState | null;
    connected: boolean;
    controller: boolean;
  };
  send: (action: Action) => void;
  effect: (text: string) => void;
}
export function createArena(parent: HTMLElement, bridge: ArenaBridge) {
  class Arena extends Phaser.Scene {
    player!: Phaser.Physics.Arcade.Sprite;
    cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    keys!: Record<string, Phaser.Input.Keyboard.Key>;
    coins: Phaser.Physics.Arcade.Sprite[] = [];
    roundKey = "";
    effectMs = 0;
    elapsed = 0;
    invincible = 0;
    cooldowns: number[] = [];
    effectLabel = "";
    trail!: Phaser.GameObjects.Particles.ParticleEmitter;
    constructor() {
      super("Arena");
    }
    create() {
      const g = this.add.graphics();
      g.fillStyle(0x141c2d);
      g.fillRect(0, 0, 960, 540);
      // Distant architecture and a fine broadcast-friendly grid.
      g.lineStyle(1, 0x263249, 0.4);
      for (let x = 0; x < 960; x += 48) {
        g.lineBetween(x, 0, x, 540);
      }
      for (let y = 0; y < 540; y += 48) g.lineBetween(0, y, 960, y);
      const mountains = [
        [0, 410, 130, 220, 260, 410],
        [170, 410, 400, 140, 620, 410],
        [520, 410, 740, 210, 960, 410],
      ];
      g.fillStyle(0x1c2840);
      for (const p of mountains)
        g.fillTriangle(p[0], p[1], p[2], p[3], p[4], p[5]);
      g.lineStyle(1, 0x43516b, 0.35);
      g.strokeCircle(760, 130, 70);
      g.strokeCircle(760, 130, 95);
      for (let i = 0; i < 42; i++) {
        g.fillStyle(i % 3 === 0 ? 0xa6b8dc : 0x50617f, 0.6);
        g.fillCircle(
          (i * 137 + 43) % 960,
          (i * 71 + 25) % 400,
          i % 3 === 0 ? 1.5 : 1,
        );
      }
      this.add.text(34, 30, "SECTOR 01 / THE PLAYGROUND", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#6d7f9c",
        letterSpacing: 2,
      });
      const tex = this.make.graphics({ x: 0, y: 0 });
      tex.fillStyle(0xc9b7ff);
      tex.fillRoundedRect(0, 0, 28, 34, 7);
      tex.fillStyle(0x26223b);
      tex.fillRoundedRect(5, 8, 18, 11, 3);
      tex.fillStyle(0xf9fbff);
      tex.fillRect(8, 11, 4, 4);
      tex.fillRect(17, 11, 4, 4);
      tex.fillStyle(0x9a82d9);
      tex.fillRect(3, 28, 7, 6);
      tex.fillRect(18, 28, 7, 6);
      tex.generateTexture("player", 28, 34);
      tex.clear();
      tex.fillStyle(0xffd777);
      tex.fillCircle(10, 10, 9);
      tex.lineStyle(2, 0xffecb3);
      tex.strokeCircle(10, 10, 6);
      tex.fillStyle(0x9b6a30);
      tex.fillRect(9, 6, 2, 8);
      tex.generateTexture("coin", 20, 20);
      tex.clear();
      tex.fillStyle(0xffffff);
      tex.fillCircle(2, 2, 2);
      tex.generateTexture("spark", 4, 4);
      tex.destroy();
      const platforms = this.physics.add.staticGroup();
      const platform = (x: number, y: number, w: number) => {
        const rect = this.add.rectangle(x, y, w, 18, 0x334258);
        this.physics.add.existing(rect, true);
        platforms.add(rect);
        this.add.rectangle(x, y - 8, w, 3, 0x8c9fb9);
        this.add.rectangle(x, y + 9, w - 8, 5, 0x101826, 0.7);
      };
      platform(480, 526, 960);
      platform(190, 415, 180);
      platform(425, 325, 170);
      platform(665, 410, 170);
      platform(800, 235, 170);
      platform(170, 190, 170);
      platform(485, 125, 180);
      this.add.text(42, 475, "SPAWN", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#7e92ae",
        letterSpacing: 2,
      });
      this.player = this.physics.add
        .sprite(70, 480, "player")
        .setCollideWorldBounds(true)
        .setDepth(5);
      this.player.body!.setSize(24, 32);
      this.physics.add.collider(this.player, platforms);
      const positions = [
        [115, 485],
        [190, 380],
        [425, 290],
        [665, 375],
        [800, 200],
        [170, 155],
        [485, 90],
        [900, 485],
      ];
      for (const [x, y] of positions) {
        const c = this.physics.add.sprite(x, y, "coin");
        (c.body as Phaser.Physics.Arcade.Body).setAllowGravity(false);
        this.coins.push(c);
        this.physics.add.overlap(this.player, c, () =>
          this.collect(this.coins.indexOf(c)),
        );
      }
      const hazards = this.physics.add.staticGroup();
      for (const x of [320, 345, 540, 565, 770]) {
        const spike = this.add.triangle(x, 507, 0, 20, 12, 0, 24, 20, 0xf08691);
        this.physics.add.existing(spike, true);
        hazards.add(spike);
      }
      this.physics.add.overlap(this.player, hazards, () => this.respawn());
      this.trail = this.add
        .particles(0, 0, "spark", {
          speed: { min: 20, max: 90 },
          lifespan: 450,
          scale: { start: 1.3, end: 0 },
          quantity: 12,
          emitting: false,
          tint: [0xffd777, 0xc9b7ff],
        })
        .setDepth(9);
      this.cursors = this.input.keyboard!.createCursorKeys();
      this.input.keyboard!.disableGlobalCapture();
      this.keys = this.input.keyboard!.addKeys(
        "A,D,W,SPACE",
        false,
      ) as typeof this.keys;
      this.input.on("pointerdown", () => parent.focus());
    }
    collect(index: number) {
      const { state: s, controller, connected } = bridge.get();
      if (
        !s ||
        !controller ||
        !connected ||
        s.phase !== "playing" ||
        s.paused ||
        this.cooldowns[index] > 0
      )
        return;
      const c = this.coins[index];
      c.disableBody(true, true);
      this.cooldowns[index] = 4000;
      this.trail.explode(14, c.x, c.y);
      bridge.send({ type: "coin", roundId: s.roundId, coinId: index });
      if (s.activeRule === "gravity" || s.activeRule === "sprint") {
        this.effectMs = 3000;
        this.cameras.main.flash(100, 180, 150, 255, false);
      }
    }
    respawn() {
      const { state: s } = bridge.get();
      if (!s || this.invincible > 0 || s.phase !== "playing" || s.paused)
        return;
      this.player.setPosition(70, 480).setVelocity(0);
      this.effectMs = 0;
      this.invincible = 1200;
      this.cameras.main.shake(100, 0.004);
      bridge.send({ type: "death", roundId: s.roundId });
    }
    update(_time: number, delta: number) {
      const { state: s, connected, controller } = bridge.get();
      if (!s) return;
      const key = s.sessionId + s.roundId;
      if (this.roundKey !== key) {
        this.roundKey = key;
        this.player.setPosition(70, 480).setVelocity(0).setAlpha(1);
        this.effectMs = 0;
        this.invincible = 0;
        this.cooldowns = this.coins.map(() => 0);
        for (const c of this.coins) c.enableBody(false, c.x, c.y, true, true);
      }
      const running =
        connected && controller && s.phase === "playing" && !s.paused;
      if (!running) {
        this.physics.pause();
        this.setEffect("");
        return;
      }
      this.physics.resume();
      const dt = Math.min(delta, 60);
      this.elapsed += dt;
      this.effectMs = advanceEffect(this.effectMs, dt, false);
      this.invincible = Math.max(0, this.invincible - dt);
      this.cooldowns = this.cooldowns.map((n, i) => {
        const next = Math.max(0, n - dt);
        if (n > 0 && next === 0) {
          const c = this.coins[i];
          c.enableBody(false, c.x, c.y, true, true);
        }
        return next;
      });
      const m = modifiers(s.activeRule, this.effectMs);
      const body = this.player.body as Phaser.Physics.Arcade.Body;
      body.setGravityY(m.gravity);
      this.player.setFlipY(m.gravity < 0);
      this.player.setAlpha(
        this.invincible > 0 ? (Math.sin(this.elapsed / 60) > 0 ? 0.4 : 1) : 1,
      );
      const active = document.activeElement === parent;
      const left = active && (this.cursors.left.isDown || this.keys.A.isDown),
        right = active && (this.cursors.right.isDown || this.keys.D.isDown);
      body.setVelocityX(left ? -m.speed : right ? m.speed : 0);
      if (left || right) this.player.setFlipX(left);
      const jump =
        Phaser.Input.Keyboard.JustDown(this.cursors.up) ||
        Phaser.Input.Keyboard.JustDown(this.keys.W) ||
        Phaser.Input.Keyboard.JustDown(this.keys.SPACE);
      if (
        active &&
        jump &&
        (m.gravity < 0
          ? body.blocked.up || body.touching.up
          : body.blocked.down || body.touching.down)
      )
        body.setVelocityY(m.gravity < 0 ? m.jump : -m.jump);
      this.setEffect(
        this.effectMs > 0
          ? `${s.activeRule === "gravity" ? "GRAVITY FLIPPED" : "SPEED BOOST"} · ${(this.effectMs / 1000).toFixed(1)}s`
          : "",
      );
      for (const c of this.coins)
        if (c.active) c.setAngle(Math.sin(this.elapsed / 400 + c.x) * 10);
    }
    setEffect(text: string) {
      if (text !== this.effectLabel) {
        this.effectLabel = text;
        bridge.effect(text);
      }
    }
  }
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: 960,
    height: 540,
    backgroundColor: "#141c2d",
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true },
    scene: Arena,
  });
}
