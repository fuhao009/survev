import * as PIXI from "pixi.js-legacy";
import type { WorldLightningEvent } from "../../shared/types/worldLightning.ts";
import type { WorldTerrain } from "../../shared/types/worldTerrain.ts";
import type { WorldWeather } from "../../shared/types/worldWeather.ts";
import { v2, type Vec2 } from "../../shared/utils/v2.ts";
import type { Camera } from "./camera.ts";
import { type Emitter, ParticleBarn } from "./objects/particles.ts";
import {
    getWorldFogFalloffSampleAlpha,
    getWorldFogVisibilityState,
    getWorldLightningVisualState,
    getWorldTerrainPatchVisual,
    getWorldWeatherEmitterState,
    MIN_FOG_VISUAL_DENSITY,
} from "./worldWeatherPresentation.ts";

const WEATHER_PARTICLE_LAYER = 3;
const FOG_FALLOFF_TEXTURE_SCALE = 0.25;

function hashText(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function hashUnit(value: string): number {
    return hashText(value) / 0xffffffff;
}

function screenRectFromBounds(camera: Camera, bounds: WorldTerrain["patches"][number]["bounds"]) {
    const topLeft = camera.m_pointToScreen({ x: bounds.min.x, y: bounds.max.y });
    const bottomRight = camera.m_pointToScreen({ x: bounds.max.x, y: bounds.min.y });
    return {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
    };
}

function drawLightningBolt(
    graphics: PIXI.Graphics,
    event: WorldLightningEvent,
    target: Vec2,
    screenWidth: number,
) {
    const seed = `${event.eventId}:bolt`;
    const startX = target.x + (hashUnit(seed) - 0.5) * screenWidth * 0.65;
    const segments = 8;
    const points: Vec2[] = [{ x: startX, y: 0 }];
    for (let index = 1; index < segments; index++) {
        const progress = index / segments;
        const jitter = (hashUnit(`${seed}:${index}`) - 0.5) * 90;
        points.push({
            x: startX + (target.x - startX) * progress + jitter,
            y: target.y * progress,
        });
    }
    points.push(target);

    graphics.lineStyle(7, 0xc9eaff, 0.35);
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) graphics.lineTo(points[index].x, points[index].y);
    graphics.lineStyle(2, 0xffffff, 0.95);
    graphics.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) graphics.lineTo(points[index].x, points[index].y);
}

export class WorldWeatherRenderer {
    readonly terrainDisplay = new PIXI.Graphics();
    readonly effectDisplay = new PIXI.Container();

    private readonly fogFalloffCanvas = document.createElement("canvas");
    private readonly fogFalloffContext = this.fogFalloffCanvas.getContext("2d")!;
    private readonly fogFalloffTexture = PIXI.Texture.from(this.fogFalloffCanvas);
    private readonly fogFalloffSprite = new PIXI.Sprite(this.fogFalloffTexture);
    private readonly lightningGraphics = new PIXI.Graphics();
    private readonly flashGraphics = new PIXI.Graphics();
    private readonly rainEmitter: Emitter;
    private readonly fogEmitter: Emitter;
    private weather: WorldWeather | null = null;
    private terrain: WorldTerrain | null = null;
    private worldSeed: string | null = null;

    constructor(private readonly particleBarn: ParticleBarn) {
        this.effectDisplay.interactiveChildren = false;
        this.fogFalloffTexture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
        this.effectDisplay.addChild(this.fogFalloffSprite, this.lightningGraphics, this.flashGraphics);
        this.rainEmitter = particleBarn.addEmitter("world_rain", {
            pos: v2.create(0, 0),
            dir: v2.create(0, -1),
            layer: WEATHER_PARTICLE_LAYER,
        });
        this.fogEmitter = particleBarn.addEmitter("world_fog", {
            pos: v2.create(0, 0),
            dir: v2.create(0.35, 0.05),
            layer: WEATHER_PARTICLE_LAYER,
        });
        this.rainEmitter.enabled = false;
        this.fogEmitter.enabled = false;
    }

    setState(
        weather: WorldWeather | null,
        terrain: WorldTerrain | null,
        worldSeed: string | null,
    ) {
        this.weather = weather;
        this.terrain = terrain;
        this.worldSeed = worldSeed;
    }

    private updateEmitters(camera: Camera, playerLayer: number) {
        const emitterState = getWorldWeatherEmitterState(this.weather, playerLayer);
        const intensity = this.weather?.intensity ?? 0;
        const fogIntensity = this.weather?.type === "fog"
            ? Math.max(MIN_FOG_VISUAL_DENSITY, Math.min(1, intensity))
            : intensity;
        const radius = Math.min(
            160,
            Math.max(80, Math.max(camera.m_screenWidth, camera.m_screenHeight) / (2 * camera.m_z()) + 24),
        );
        const position = v2.copy(camera.m_pos);

        this.rainEmitter.pos = position;
        this.rainEmitter.radius = radius;
        this.rainEmitter.rateMult = emitterState.rainRateMultiplier;
        this.rainEmitter.alpha = emitterState.rainEnabled ? Math.min(1, intensity * 1.25) : 0;
        this.rainEmitter.enabled = emitterState.rainEnabled;

        this.fogEmitter.pos = position;
        this.fogEmitter.radius = radius * 0.85;
        this.fogEmitter.rateMult = emitterState.fogRateMultiplier;
        this.fogEmitter.alpha = emitterState.fogEnabled ? Math.min(0.42, fogIntensity * 0.5) : 0;
        this.fogEmitter.enabled = emitterState.fogEnabled;
    }

    private renderTerrain(camera: Camera) {
        this.terrainDisplay.clear();
        if (!this.terrain) return;

        const weatherType = this.weather?.type ?? "clear";
        for (const patch of this.terrain.patches) {
            const rect = screenRectFromBounds(camera, patch.bounds);
            const visual = getWorldTerrainPatchVisual(patch.type, weatherType, patch.intensity);
            this.terrainDisplay.beginFill(visual.color, visual.alpha);
            this.terrainDisplay.drawRect(rect.x, rect.y, rect.width, rect.height);
            this.terrainDisplay.endFill();

            if (patch.type === "flooded") {
                this.terrainDisplay.lineStyle(2, 0xa6dcf5, Math.min(0.3, visual.alpha + 0.08));
                for (let offset = 18; offset < rect.height; offset += 28) {
                    this.terrainDisplay.moveTo(rect.x + 10, rect.y + offset);
                    this.terrainDisplay.lineTo(rect.x + rect.width - 10, rect.y + offset + 3);
                }
            }
        }
    }

    private resizeFogFalloffTexture(camera: Camera) {
        const width = Math.max(1, Math.ceil(camera.m_screenWidth * FOG_FALLOFF_TEXTURE_SCALE));
        const height = Math.max(1, Math.ceil(camera.m_screenHeight * FOG_FALLOFF_TEXTURE_SCALE));
        if (this.fogFalloffCanvas.width !== width || this.fogFalloffCanvas.height !== height) {
            this.fogFalloffCanvas.width = width;
            this.fogFalloffCanvas.height = height;
            this.fogFalloffTexture.baseTexture.setRealSize(width, height);
        }
        return { width, height };
    }

    private renderFogFalloff(camera: Camera, playerLayer: number, focusPosition: Vec2) {
        const fogState = getWorldFogVisibilityState(this.weather, playerLayer);
        if (!fogState.enabled) {
            this.fogFalloffSprite.visible = false;
            return;
        }

        const center = camera.m_pointToScreen(focusPosition);
        const { width, height } = this.resizeFogFalloffTexture(camera);
        const imageData = this.fogFalloffContext.createImageData(width, height);
        const data = imageData.data;
        const red = (fogState.color >> 16) & 255;
        const green = (fogState.color >> 8) & 255;
        const blue = fogState.color & 255;
        const screenStepX = camera.m_screenWidth / width;
        const screenStepY = camera.m_screenHeight / height;
        const zoom = camera.m_z();

        for (let y = 0; y < height; y++) {
            const screenY = (y + 0.5) * screenStepY;
            const worldY = camera.m_pos.y + (camera.m_screenHeight * 0.5 - screenY) / zoom;
            const dy = (center.y - screenY) / zoom;
            for (let x = 0; x < width; x++) {
                const screenX = (x + 0.5) * screenStepX;
                const worldX = camera.m_pos.x + (screenX - camera.m_screenWidth * 0.5) / zoom;
                const dx = (screenX - center.x) / zoom;
                const distance = Math.hypot(dx, dy);
                const baseAlpha = getWorldFogFalloffSampleAlpha(distance, fogState);
                if (baseAlpha <= 0) continue;

                const lowCloud = Math.sin(worldX * 0.34 + worldY * 0.27);
                const crossCloud = Math.sin(worldX * -0.19 + worldY * 0.42 + 1.7);
                const fineMist = Math.sin(worldX * 1.23 - worldY * 0.91 + 0.4);
                const cloudFactor = Math.max(
                    0.78,
                    Math.min(1.08, 0.93 + lowCloud * 0.08 + crossCloud * 0.05 + fineMist * 0.025),
                );
                const alpha = Math.min(0.95, baseAlpha * cloudFactor);
                const offset = (y * width + x) * 4;
                data[offset] = red;
                data[offset + 1] = green;
                data[offset + 2] = blue;
                data[offset + 3] = Math.round(alpha * 255);
            }
        }

        this.fogFalloffContext.putImageData(imageData, 0, 0);
        this.fogFalloffTexture.update();
        this.fogFalloffSprite.position.set(0, 0);
        this.fogFalloffSprite.width = camera.m_screenWidth;
        this.fogFalloffSprite.height = camera.m_screenHeight;
        this.fogFalloffSprite.visible = true;
    }

    private renderLightning(camera: Camera, now: number) {
        this.lightningGraphics.clear();
        this.flashGraphics.clear();
        if (!this.weather || this.weather.type !== "thunderstorm" || !this.worldSeed) return;

        const visualState = getWorldLightningVisualState(this.worldSeed, this.weather, now);
        for (const event of visualState.warningEvents) {
            const target = camera.m_pointToScreen(event.position);
            const radius = camera.m_scaleToScreen(event.radius);
            const pulse = 0.55 + Math.sin(now / 90) * 0.25;
            this.lightningGraphics.lineStyle(3, 0xffe07a, pulse);
            this.lightningGraphics.drawCircle(target.x, target.y, radius);
            this.lightningGraphics.lineStyle(1, 0xfff5b3, pulse * 0.7);
            this.lightningGraphics.drawCircle(target.x, target.y, radius * 0.65);
        }

        for (const event of visualState.activeEvents) {
            const target = camera.m_pointToScreen(event.position);
            const radius = camera.m_scaleToScreen(event.radius);

            const age = now - event.strikeAt;
            drawLightningBolt(this.lightningGraphics, event, target, camera.m_screenWidth);
            this.lightningGraphics.beginFill(0xe9f8ff, 0.85);
            this.lightningGraphics.drawCircle(target.x, target.y, Math.max(12, radius * 0.18));
            this.lightningGraphics.endFill();
            this.lightningGraphics.lineStyle(4, 0x9edcff, 0.8);
            this.lightningGraphics.drawCircle(target.x, target.y, radius * (0.25 + Math.min(0.35, age / 500)));
        }

        if (visualState.flashAlpha > 0) {
            this.flashGraphics.beginFill(0xeaf7ff, visualState.flashAlpha);
            this.flashGraphics.drawRect(0, 0, camera.m_screenWidth, camera.m_screenHeight);
            this.flashGraphics.endFill();
        }
    }

    update(camera: Camera, playerLayer: number, focusPosition: Vec2, now = Date.now()) {
        this.updateEmitters(camera, playerLayer);
        this.renderTerrain(camera);
        this.renderFogFalloff(camera, playerLayer, focusPosition);
        this.renderLightning(camera, now);
    }

    free() {
        this.rainEmitter.free();
        this.fogEmitter.free();
        this.terrainDisplay.clear();
        this.lightningGraphics.clear();
        this.flashGraphics.clear();
        this.effectDisplay.removeChildren();
        this.terrainDisplay.parent?.removeChild(this.terrainDisplay);
        this.effectDisplay.parent?.removeChild(this.effectDisplay);
        this.terrainDisplay.destroy();
        this.fogFalloffTexture.destroy(true);
        this.effectDisplay.destroy({ children: true });
    }
}
