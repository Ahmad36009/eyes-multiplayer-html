import {PerspectiveCamera, Quaternion, Vector3} from './three.js';

const keyframes = [
  [0, 0, -.9, .5, 0],
  [.267, 0, -.8, .65, 0],
  [1.281, 0, -.7415, .65, 0],
  [2, 0, -.7, .65, 0],
];

export function createKrasueJumpscare() {
  const forward = new Vector3(), right = new Vector3(), position = new Vector3();
  const startPosition = new Vector3();
  const face = new Vector3(), separation = new Vector3();
  const faceOffset = new Vector3(-.1211, -.0003, .1051);
  const aim = new PerspectiveCamera();
  const view = new Quaternion(), beam = new Quaternion();
  let lastTime = null;
  return {
    reset() { lastTime = null; },
    update(time, dt, camera, ghost, attack, flash, catchPosition) {
      const firstFrame = lastTime === null || time < lastTime;
      if (firstFrame) {
        const source = catchPosition ?? ghost.position.toArray();
        startPosition.set(source[0], source[1], -source[2]);
        forward.set(startPosition.x-camera.position.x,0,startPosition.z-camera.position.z);
        if (forward.lengthSq()<1e-6) {
          camera.getWorldDirection(forward);
          forward.y=0;
        }
        forward.normalize();
        right.set(-forward.z, 0, forward.x);
        view.copy(camera.quaternion);
        beam.copy(camera.quaternion);
      }
      const elapsed = lastTime === null || time < lastTime ? 0 : time - lastTime;
      lastTime = time;
      const end = keyframes.findIndex(frame => frame[0] >= time);
      const b = keyframes[end < 0 ? keyframes.length - 1 : end];
      const a = keyframes[Math.max(0, (end < 0 ? keyframes.length - 1 : end) - 1)];
      const blend = a === b ? 0 : Math.min(1, (time - a[0]) / (b[0] - a[0]));
      const value = index => a[index] + (b[index] - a[index]) * blend;
      position.copy(camera.position).addScaledVector(right, value(1)).addScaledVector(forward, value(3));
      position.y += value(2);
      const entry = firstFrame ? 0 : Math.min(1, time / .267);
      position.lerp(startPosition, 1 - entry*entry*(3-2*entry));

      ghost.visible = true;
      ghost.position.set(position.x, position.y, -position.z);
      ghost.rotation.y = Math.atan2(camera.position.x - position.x, position.z - camera.position.z) + value(4) * Math.PI / 180;
      attack.update(time);

      const head = ghost.getObjectByName('Bone01');
      if (head) head.localToWorld(face.copy(faceOffset));
      else face.copy(position).addScaledVector(camera.up, 1.49);
      aim.position.copy(camera.position);
      aim.lookAt(face);
      view.slerp(aim.quaternion, Math.min(1, elapsed * 10));

      separation.subVectors(camera.position, position);
      separation.y = 0;
      if (separation.lengthSq() < 1) {
        camera.position.addScaledVector(separation, elapsed * 2);
        ghost.position.x -= separation.x * elapsed * 2;
        ghost.position.z += separation.z * elapsed * 2;
      }
      const progress = Math.min(1, time / .5);
      camera.fov = 60 - 10 * progress * (2 - progress);
      camera.updateProjectionMatrix();

      beam.slerp(aim.quaternion, 1 - Math.exp(-8 * dt));
      camera.quaternion.copy(beam);
      flash.update(1 / 12, 0, true);
      camera.quaternion.copy(view);
    },
  };
}
