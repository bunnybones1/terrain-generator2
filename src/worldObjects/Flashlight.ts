import { Object3D, PerspectiveCamera, SpotLight, Vector3 } from "three";

export default class Flashlight {
  toggle() {
    this.light.visible = !this.light.visible;
  }
  light: SpotLight;
  lightTarget: Object3D;
  position: Vector3;
  velocity: Vector3;
  aimVelocity: Vector3;
  aim: Vector3;
  // Flashlight (SpotLight) in scene (not parented to camera) but follows it
  constructor(private camera: PerspectiveCamera) {
    const flashlight = new SpotLight(0xffffff, 15, 30, Math.PI / 8, 0.35, 2);
    flashlight.name = "CameraFlashlight";
    // flashlight.castShadow = true;
    // flashlight.shadow.mapSize.set(1024, 1024);
    // flashlight.shadow.bias = -0.0001;
    // Spring-follow state for flashlight
    this.position = new Vector3().copy(camera.position);
    this.velocity = new Vector3(0, 0, 0);
    // Aim direction lag state
    this.aim = new Vector3();
    camera.getWorldDirection(this.aim).normalize();
    this.aimVelocity = new Vector3(0, 0, 0);

    flashlight.position.copy(camera.position);
    this.light = flashlight;
    this.lightTarget = flashlight.target;
  }
  update(dta: number) {
    const dt = Math.min(0.03, dta);
    // Camera basis
    const forward = new Vector3();
    this.camera.getWorldDirection(forward); // normalized forward
    // Right vector = normalize(forward x worldUp)
    const worldUp = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(forward, worldUp).normalize();

    // Desired offset: a bit in front and to the right of the camera
    const desiredPos = new Vector3()
      .copy(this.camera.position)
      .addScaledVector(forward, -0.1) // forward offset
      .addScaledVector(worldUp, -0.13) // forward offset
      .addScaledVector(right, 0.15); // right offset

    // Critically damped spring toward desiredPos
    // Parameters
    const stiffness = 300; // higher = snappier
    const damping = 2 * Math.sqrt(stiffness); // critical damping
    // Integrate velocity and position
    const toTarget = new Vector3().subVectors(desiredPos, this.position);
    // acceleration = k*x - c*v
    const accel = new Vector3()
      .copy(toTarget)
      .multiplyScalar(stiffness)
      .addScaledVector(this.velocity, -damping);

    this.velocity.addScaledVector(accel, dt);
    this.position.addScaledVector(this.velocity, dt);

    // Apply to spotlight
    this.light.position.copy(this.position);

    // Aim lag: make the flashlight's look direction lag behind the camera's forward
    {
      const desiredAim = forward; // already normalized
      // Spring params (match position spring "feel")
      const aimStiffness = 300;
      const aimDamping = 2 * Math.sqrt(aimStiffness);

      // Spring toward desiredAim in vector space, then normalize
      const aimError = new Vector3().subVectors(desiredAim, this.aim);
      const aimAccel = new Vector3()
        .copy(aimError)
        .multiplyScalar(aimStiffness)
        .addScaledVector(this.aimVelocity, -aimDamping);

      this.aimVelocity.addScaledVector(aimAccel, dt);
      this.aim.addScaledVector(this.aimVelocity, dt);

      // Avoid drift to zero; renormalize
      if (this.aim.lengthSq() > 1e-6) this.aim.normalize();
      else this.aim.copy(desiredAim);
    }

    // Use lagged aim to set the target from current flashlight position
    const targetPos = new Vector3().copy(this.position).addScaledVector(this.aim, 10);
    this.light.target.position.copy(targetPos);

    this.light.updateMatrixWorld();
    this.light.target.updateMatrixWorld();
  }
}
