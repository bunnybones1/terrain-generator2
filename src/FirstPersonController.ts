import { Object3D, PerspectiveCamera, Raycaster, Vector2, Vector3, WebGLRenderer } from "three";
import { TerrainSampler } from "./terrain/TerrainSampler";
import { TerrainRenderer } from "./terrain/TerrainRenderer";
import { TerrainData } from "./terrain/TerrainData";

// Movement helpers
const tmpDir = new Vector3();
const tmpRight = new Vector3();
const up = new Vector3(0, 1, 0);

const speedBoost = 1;
const initialHeight = 0;

// face a default direction along the outward angle (optional: keep as zero)

export default class FirstPersonController {
  yaw = 0;
  pitch = -0.1;
  keys: Record<string, boolean> = {};
  velocityY = 0;
  gravity = -85; // m/s^2
  eyeHeight = 1.5; // meters above ground
  pointerLocked = false;

  // Movement modes
  private isFlying = false;
  private lastToggleTime = 0;

  // Flying speed ramp state
  private flySpeed = 10; // current fly speed (m/s)
  private flyMinSpeed = 8; // minimum cruise speed (m/s)
  private flyMaxSpeed = 600; // maximum top speed (m/s) without sprint
  private flyAccel = 20; // m/s^2 while holding forward
  private flyDecay = 10; // m/s^2 when not holding forward
  private flySprintMultiplier = 2; // sprint doubles current fly speed

  // Smoothing and bobbing
  private smoothedPos = new Vector3();
  private time = 0;

  // Persistent movement target (basis for real position)
  private target = new Vector3();

  // Dig/raycast helpers
  private raycaster = new Raycaster();
  private mouseNDC = new Vector2();
  private isDigging = false;

  // Digging settings
  public digRadius: number = 2.0; // meters

  constructor(
    public camera: PerspectiveCamera,
    private terrainSampler: TerrainSampler,
    renderer: WebGLRenderer,
    private terrainRenderer: TerrainRenderer,
    private terrainData: TerrainData
  ) {
    // Pointer lock for mouse look
    renderer.domElement.addEventListener("click", () => {
      renderer.domElement.requestPointerLock();
    });
    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === renderer.domElement;
    });
    document.addEventListener("mousemove", (e) => {
      // update last mouse NDC for raycasting (even if not locked)
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      this.mouseNDC.set(x, y);

      if (!this.pointerLocked) return;
      const sensitivity = 0.0025;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      const maxPitch = Math.PI / 2 - 0.01;
      if (this.pitch > maxPitch) this.pitch = maxPitch;
      if (this.pitch < -maxPitch) this.pitch = -maxPitch;
    });

    document.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      if (e.code === "KeyF") {
        const now = performance.now();
        if (now - this.lastToggleTime > 200) {
          this.isFlying = !this.isFlying;
          this.lastToggleTime = now;
          // Reset vertical velocity when switching modes
          this.velocityY = 0;
          // Reset fly speed toward minimum when entering flying
          if (this.isFlying) {
            this.flySpeed = this.flyMinSpeed;
          }
        }
      }
    });
    document.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });

    // Press-and-hold digging handlers
    renderer.domElement.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return; // left button only
      // update NDC immediately
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      this.mouseNDC.set(x, y);
      this.isDigging = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        this.isDigging = false;
      }
    });
  }

  setLocation(x: number, z: number, angle: number) {
    // Use island spawn to set initial camera position at shoreline and yaw
    this.camera.position.x = x;
    this.camera.position.z = z;
    // Initialize yaw so camera faces the sea from spawn
    // Our convention: yaw rotates around Y, forward vector is (0,0,-1) at yaw=0; to face (dx,dz), yaw = atan2(dx, -dz)
    this.yaw = angle;
    // height should be very close to 0; use sampler for consistency and add a small offset
    const groundH0 = this.terrainSampler.getSample(x, z).baseHeight + initialHeight;
    this.camera.position.y = Math.max(-1000, groundH0) + this.eyeHeight + 0.5;

    // Initialize smoothed position
    this.smoothedPos.copy(this.camera.position);

    // Initialize persistent target to current camera position
    this.target.copy(this.camera.position);
  }
  update(dt: number) {
    // Update accumulated time
    this.time += dt;

    // Update camera orientation from yaw/pitch
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);

    const isSwimming = this.camera.position.y < 0.5 && !this.isFlying;

    let moveSpeed: number;
    let moveX = 0;
    let moveZ = 0;

    // Movement input
    if (this.keys["KeyW"]) moveZ += 1;
    if (this.keys["KeyS"]) moveZ -= 1;
    if (this.keys["KeyA"]) moveX -= 1;
    if (this.keys["KeyD"]) moveX += 1;
    const len = Math.hypot(moveX, moveZ) || 1;
    moveX /= len;
    moveZ /= len;

    if (this.isFlying) {
      // Update fly speed ramp
      const forwardHeld = moveZ > 0.5; // pressing W predominantly
      if (forwardHeld) {
        this.flySpeed += this.flyAccel * dt;
      } else {
        this.flySpeed -= this.flyDecay * dt;
      }
      // Clamp fly speed between min and max
      this.flySpeed = Math.min(Math.max(this.flySpeed, this.flyMinSpeed), this.flyMaxSpeed);

      // Apply sprint multiplier if held
      const sprinting = this.keys["ShiftLeft"] || this.keys["ShiftRight"];
      const currentFlySpeed = sprinting ? this.flySpeed * this.flySprintMultiplier : this.flySpeed;

      // Flying: much faster than swimming, free 3D movement, no gravity
      moveSpeed = currentFlySpeed * speedBoost;

      // Full 3D forward/right based on camera
      tmpDir.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
      tmpRight.copy(tmpDir).cross(up).normalize();

      const vx = (tmpRight.x * moveX + tmpDir.x * moveZ) * moveSpeed * dt;
      let vy = (tmpRight.y * moveX + tmpDir.y * moveZ) * moveSpeed * dt;
      const vz = (tmpRight.z * moveX + tmpDir.z * moveZ) * moveSpeed * dt;

      // Vertical controls while flying
      const verticalFlySpeed = moveSpeed; // same scale as horizontal when holding Space/Ctrl
      if (this.keys["Space"]) vy += verticalFlySpeed * dt;
      if (this.keys["ControlLeft"] || this.keys["ControlRight"]) vy -= verticalFlySpeed * dt;

      this.target.x += vx;
      this.target.y += vy;
      this.target.z += vz;

      // Keep camera above ground while flying
      const groundH_fly = this.terrainSampler.getSample(this.target.x, this.target.z).baseHeight;
      const minFlyY = groundH_fly + this.eyeHeight + 1;
      if (this.target.y < minFlyY) {
        this.target.y = minFlyY;
      }

      // Add subtle flying bobbing and sway (lighter/faster than swimming)
      const fbobSpeed = 0.5; // Hz-like
      const fbobAmountY = 0.006; // meters
      const fswayAmountX = 0.004; // meters (left-right sway)
      const fswayAmountZ = 0.002; // meters (forward/back ripple)
      const fw = Math.PI * 2 * fbobSpeed;

      const right = tmpRight; // normalized already
      const forward = tmpDir; // normalized already

      const bobYf = Math.sin(this.time * fw) * fbobAmountY;
      const swayXf = Math.sin(this.time * fw * 0.7) * fswayAmountX;
      const rippleZf = Math.cos(this.time * fw * 0.9) * fswayAmountZ;

      this.target.x += right.x * swayXf + forward.x * rippleZf;
      this.target.y += bobYf;
      this.target.z += right.z * swayXf + forward.z * rippleZf;

      // No gravity while flying
      this.velocityY = 0;
      // When not flying, relax flySpeed toward minimum
      if (!this.isFlying) {
        if (this.flySpeed > this.flyMinSpeed) {
          this.flySpeed = Math.max(this.flyMinSpeed, this.flySpeed - this.flyDecay * dt);
        } else if (this.flySpeed < this.flyMinSpeed) {
          this.flySpeed = Math.min(this.flyMinSpeed, this.flySpeed + this.flyDecay * dt);
        }
      }
    } else if (isSwimming) {
      // Swimming speeds: slower than walking, but sprint with Shift
      moveSpeed = this.keys["ShiftLeft"] || this.keys["ShiftRight"] ? 6 : 2; // m/s
      moveSpeed *= speedBoost;

      // Full 3D forward direction from camera
      tmpDir.set(0, 0, -1).applyEuler(this.camera.rotation).normalize();
      tmpRight.copy(tmpDir).cross(up).normalize();

      // 3D movement
      const vx = (tmpRight.x * moveX + tmpDir.x * moveZ) * moveSpeed * dt;
      let vy = (tmpRight.y * moveX + tmpDir.y * moveZ) * moveSpeed * dt;
      const vz = (tmpRight.z * moveX + tmpDir.z * moveZ) * moveSpeed * dt;

      // Vertical swim control: Space to ascend, Ctrl to descend
      const verticalSwimSpeed = 2.5; // m/s
      if (this.keys["Space"] && this.target.y < 0.1) {
        vy += verticalSwimSpeed * dt;
      } else if (this.keys["ControlLeft"] || this.keys["ControlRight"]) {
        vy -= verticalSwimSpeed * dt;
      }

      this.target.x += vx;
      this.target.y += vy;
      this.target.z += vz;

      // Keep camera above ground while swimming
      const groundH_swim = this.terrainSampler.getSample(this.target.x, this.target.z).baseHeight;
      const minSwimY = groundH_swim + 0.25;
      if (this.target.y < minSwimY) {
        this.target.y = minSwimY;
      }

      // Add subtle swim bobbing and sway
      const bobSpeed = 0.8; // Hz-like, scaled by 2π below
      const bobAmountY = 0.02; // meters
      const swayAmountX = 0.01; // meters (left-right sway)
      const swayAmountZ = 0.006; // meters (forward-back ripple)
      const w = Math.PI * 2 * bobSpeed;

      // Directional basis for sway tied to camera
      const right = tmpRight; // already normalized
      const forward = tmpDir; // already normalized

      const bobY = Math.sin(this.time * w) * bobAmountY;
      const swayX = Math.sin(this.time * w * 0.5) * swayAmountX; // slower lateral sway
      const rippleZ = Math.cos(this.time * w) * swayAmountZ;

      this.target.x += right.x * swayX + forward.x * rippleZ;
      this.target.y += bobY;
      this.target.z += right.z * swayX + forward.z * rippleZ;

      // No gravity while swimming
      this.velocityY = 0;
    } else {
      // Walking speeds
      moveSpeed = this.keys["ShiftLeft"] || this.keys["ShiftRight"] ? 12 : 4; // m/s
      moveSpeed *= speedBoost;

      // Build forward and right vectors on XZ plane
      tmpDir.set(0, 0, -1).applyEuler(this.camera.rotation).setY(0).normalize();
      tmpRight.copy(tmpDir).cross(up).normalize();

      const dx = (tmpRight.x * moveX + tmpDir.x * moveZ) * moveSpeed * dt;
      const dz = (tmpRight.z * moveX + tmpDir.z * moveZ) * moveSpeed * dt;

      // Horizontal movement
      this.target.x += dx;
      this.target.z += dz;

      // Gravity and ground collision with restitution bounce
      // Integrate velocity with acceleration (gravity)
      this.velocityY += this.gravity * dt;

      const groundH = this.terrainSampler.getSample(this.target.x, this.target.z).baseHeight;
      const targetEyeY = groundH + this.eyeHeight;

      // Integrate position with current velocity
      let newY = this.camera.position.y + this.velocityY * dt;

      // Collision and bounce
      if (newY < targetEyeY) {
        // Hit ground: place at ground and bounce with 50% restitution
        newY = targetEyeY;
        this.velocityY = -this.velocityY * 0.25;

        // If bounce is too small, stop to avoid jitter
        if (Math.abs(this.velocityY) < 0.5) {
          this.velocityY = 0;
        }
      }

      this.target.y = newY;
    }

    // Continuous digging while mouse is held
    if (this.isDigging) {
      // When pointer is locked, always dig straight from screen center; else use mouse position
      if (this.pointerLocked) {
        this.raycaster.setFromCamera(new Vector2(0, 0), this.camera);
      } else {
        this.raycaster.setFromCamera(this.mouseNDC, this.camera);
      }
      const terrainMeshes: Object3D[] = [];
      for (const entry of this.terrainRenderer.tiles.values()) {
        terrainMeshes.push(entry.mesh);
      }
      if (terrainMeshes.length > 0) {
        const hits = this.raycaster.intersectObjects(terrainMeshes, true);
        if (hits.length > 0) {
          const hit = hits[0];
          const hx = hit.point.x;
          const hz = hit.point.z;
          const radius = this.digRadius;
          const digRate = this.digRadius * 0.5;
          const depthThisFrame = digRate * dt;
          this.terrainData.addDigSphere(hx, hz, radius, depthThisFrame);
        }
      }
    }

    // Lerp smoothed position towards target
    const smoothPosLerp = 1 - Math.pow(0.0005, dt); // time-independent smoothing (~strong smoothing)
    this.smoothedPos.lerp(this.target, smoothPosLerp);

    // Apply smoothed position to camera
    this.camera.position.copy(this.smoothedPos);
  }
}
