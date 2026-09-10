"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { OrthographicCamera, type Group } from "three";
import type { Material } from "@circular-city/contracts";
import { buildCityRenderModel } from "./cityRenderModel";
import type {
  CityFacility,
  CityProject,
  CityRenderModel,
  CityTransferEffect,
  CityTransit,
  GameSnapshot,
} from "./types";
import styles from "./CityScene.module.css";

type SceneQuality = "standard" | "low";
type Position = readonly [number, number, number];

type CitySceneProps = {
  snapshot: GameSnapshot;
  selectedFacility: CityFacility;
  onSelectFacility: (facility: CityFacility) => void;
  effects?: CityTransferEffect[];
};

const facilities: Array<{
  id: CityFacility;
  label: string;
  description: string;
  position: Position;
  color: string;
}> = [
  {
    id: "municipality",
    label: "Municipality Hall",
    description: "Collection planning and city logistics",
    position: [-5.4, 0, 1.2],
    color: "#18a999",
  },
  {
    id: "mrf",
    label: "MRF Recovery Works",
    description: "Recovery queue, sorting lines, and quality",
    position: [-2.2, 0, -4.2],
    color: "#5879c9",
  },
  {
    id: "broker",
    label: "Circular Exchange",
    description: "Procurement, trades, and deliveries",
    position: [5.3, 0, -1.5],
    color: "#e28d35",
  },
  {
    id: "warehouse",
    label: "Shared Warehouse",
    description: "Team material inventory and quality grades",
    position: [1.6, 0, 2.8],
    color: "#bc7a45",
  },
  {
    id: "future-site",
    label: "Future City Site",
    description: "Closed for future development",
    position: [-2.6, 0, 4.7],
    color: "#7f8790",
  },
];

const projectPositions: Position[] = [
  [-4.6, 0.08, 5.1],
  [-1.9, 0.08, 5.8],
  [1.0, 0.08, 5.8],
  [4.0, 0.08, 4.7],
  [5.8, 0.08, 2.2],
  [6.1, 0.08, -0.5],
];

const treePositions: Position[] = [
  [-6.6, 0.08, -2.5],
  [-5.8, 0.08, 4.1],
  [-3.7, 0.08, -5.2],
  [0.4, 0.08, -6.2],
  [3.0, 0.08, -5.6],
  [6.6, 0.08, -3.7],
  [6.8, 0.08, 3.2],
  [0.1, 0.08, 2.3],
];

const neighborhoodPositions: Position[] = [
  [-4.5, 0, -1.5],
  [-3.8, 0, -2.3],
  [-3.2, 0, -1.2],
  [2.3, 0, -2.4],
  [3.1, 0, -3.1],
  [3.7, 0, 1.6],
];

const materialColors: Record<Material, string> = {
  paper: "#d7a85d",
  plastic: "#26b6ba",
  metal: "#7194bd",
  glass: "#6cae8f",
  wood: "#a66c43",
};

const projectColor: Record<CityProject["status"], string> = {
  announced: "#9da6b1",
  active: "#f0ab37",
  queued: "#7e8ca1",
  claimed: "#49a86e",
  expired: "#6c7280",
  cancelled: "#875d73",
};

const facilityColorStyle = (
  color: string,
): CSSProperties & { "--facility-color": string } => ({
  "--facility-color": color,
});

function supportsWebGl(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl")),
    );
  } catch {
    return false;
  }
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return reducedMotion;
}

export function CityScene({
  snapshot,
  selectedFacility,
  onSelectFacility,
  effects = [],
}: CitySceneProps) {
  const model = useMemo(() => buildCityRenderModel(snapshot), [snapshot]);
  const reducedMotion = useReducedMotion();
  const [webGlAvailable, setWebGlAvailable] = useState<boolean | null>(null);
  const [quality, setQuality] = useState<SceneQuality>("standard");
  const selected =
    facilities.find((facility) => facility.id === selectedFacility) ??
    facilities[0]!;

  useEffect(() => setWebGlAvailable(supportsWebGl()), []);

  if (webGlAvailable === false) {
    return (
      <CityFallback
        model={model}
        onSelectFacility={onSelectFacility}
        selectedFacility={selectedFacility}
      />
    );
  }

  return (
    <section className={styles.cityStage} aria-label="Shared circular city">
      {webGlAvailable === null ? (
        <div className={styles.loadingScene} aria-live="polite">
          Building your circular city...
        </div>
      ) : (
        <Canvas
          aria-hidden="true"
          camera={{ far: 80, near: 0.1, position: [0, 13, 14], zoom: 44 }}
          dpr={quality === "low" ? 1 : [1, 1.5]}
          gl={{
            antialias: quality === "standard",
            powerPreference: "high-performance",
          }}
          orthographic
          shadows={quality === "standard"}
        >
          <CameraRig />
          <CityWorld
            effects={effects}
            model={model}
            onSelectFacility={onSelectFacility}
            reducedMotion={reducedMotion || quality === "low"}
            selectedFacility={selectedFacility}
          />
        </Canvas>
      )}

      <div className={styles.facilityLabel} aria-live="polite">
        <span
          className={styles.facilitySwatch}
          style={facilityColorStyle(selected.color)}
        />
        <span>
          <strong>{selected.label}</strong>
          <small>{selected.description}</small>
        </span>
      </div>

      <label className={styles.qualityControl}>
        Scene
        <select
          value={quality}
          onChange={(event) => setQuality(event.target.value as SceneQuality)}
        >
          <option value="standard">Standard</option>
          <option value="low">Low effects</option>
        </select>
      </label>

      <p className="srOnly" aria-live="polite">
        {model.waste.available} collection sources available.{" "}
        {model.waste.queued}
        batches queued at MRF. {model.waste.processing} batches processing.{" "}
        {model.activeTradeCount}
        active trades. City health is {model.health} percent.
      </p>
    </section>
  );
}

function CameraRig() {
  const { camera, size } = useThree();

  useEffect(() => {
    camera.position.set(0, 13, 14);
    camera.lookAt(0, 0, 0);

    if (camera instanceof OrthographicCamera) {
      camera.zoom = Math.max(
        18,
        Math.min(58, size.width / 19, size.height / 18),
      );
    }

    camera.updateProjectionMatrix();
  }, [camera, size.height, size.width]);

  return null;
}

function CityWorld({
  effects,
  model,
  onSelectFacility,
  reducedMotion,
  selectedFacility,
}: {
  effects: CityTransferEffect[];
  model: CityRenderModel;
  onSelectFacility: (facility: CityFacility) => void;
  reducedMotion: boolean;
  selectedFacility: CityFacility;
}) {
  return (
    <>
      <color args={["#8dcfd0"]} attach="background" />
      <fog args={["#8dcfd0", 20, 38]} attach="fog" />
      <ambientLight intensity={1.55} />
      <directionalLight
        castShadow
        intensity={2.2}
        position={[7, 12, 8]}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
      />
      <hemisphereLight args={["#e6fff4", "#31575a", 1.15]} />
      <CityGround health={model.health} />
      <CircularLoop reducedMotion={reducedMotion} />
      <AmbientTraffic reducedMotion={reducedMotion} />
      <PedestrianFlow reducedMotion={reducedMotion} />
      <Neighborhood />
      <Facility
        active={model.waste.available > 0}
        color={facilities[0]!.color}
        interactive={model.role === "municipality"}
        label={facilities[0]!.label}
        onSelect={() => onSelectFacility("municipality")}
        position={facilities[0]!.position}
        selected={selectedFacility === "municipality"}
        variant="municipality"
      />
      <Facility
        active={model.waste.queued + model.waste.processing > 0}
        color={facilities[1]!.color}
        interactive={model.role === "mrf"}
        label={facilities[1]!.label}
        onSelect={() => onSelectFacility("mrf")}
        position={facilities[1]!.position}
        selected={selectedFacility === "mrf"}
        variant="mrf"
      />
      <Facility
        active={model.activeTradeCount > 0}
        color={facilities[2]!.color}
        interactive={model.role === "broker"}
        label={facilities[2]!.label}
        onSelect={() => onSelectFacility("broker")}
        position={facilities[2]!.position}
        selected={selectedFacility === "broker"}
        variant="broker"
      />
      <Facility
        active={Object.values(model.inventoryKg).some((amount) => amount > 0)}
        color={facilities[3]!.color}
        interactive
        label={facilities[3]!.label}
        onSelect={() => onSelectFacility("warehouse")}
        position={facilities[3]!.position}
        selected={selectedFacility === "warehouse"}
        variant="warehouse"
      />
      <Facility
        active={false}
        color={facilities[4]!.color}
        interactive={false}
        label={facilities[4]!.label}
        onSelect={() => undefined}
        position={facilities[4]!.position}
        selected={selectedFacility === "future-site"}
        variant="closed"
      />
      <InventorySilos inventoryKg={model.inventoryKg} />
      {model.projects.map((project, index) => (
        <ProjectPlot
          key={project.id}
          project={project}
          reducedMotion={reducedMotion}
          position={projectPositions[index] ?? projectPositions[0]!}
        />
      ))}
      {model.transits.map((transit) => (
        <TransitMarker
          key={transit.id}
          reducedMotion={reducedMotion}
          transit={transit}
        />
      ))}
      {effects.map((effect) => (
        <TransferEffectMarker
          effect={effect}
          key={effect.id}
          reducedMotion={reducedMotion}
        />
      ))}
    </>
  );
}

function CityGround({ health }: { health: number }) {
  const vegetationColor =
    health < 20 ? "#637552" : health <= 50 ? "#6d995b" : "#87bd68";

  return (
    <group>
      <mesh receiveShadow rotation-x={-Math.PI / 2}>
        <circleGeometry args={[9.5, 64]} />
        <meshStandardMaterial color="#527a6c" roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.012, 0]} receiveShadow rotation-x={-Math.PI / 2}>
        <circleGeometry args={[8.6, 64]} />
        <meshStandardMaterial color="#79ad75" roughness={0.96} />
      </mesh>
      {treePositions.map((position, index) => (
        <group key={position.join("-")} position={position}>
          <mesh castShadow position={[0, 0.36, 0]}>
            <cylinderGeometry args={[0.09, 0.12, 0.72, 8]} />
            <meshStandardMaterial color="#7f5539" roughness={0.9} />
          </mesh>
          <mesh castShadow position={[0, 0.92, 0]}>
            <sphereGeometry args={[0.46 + (index % 2) * 0.08, 12, 10]} />
            <meshStandardMaterial color={vegetationColor} roughness={0.88} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Neighborhood() {
  return (
    <group>
      {neighborhoodPositions.map((position, index) => (
        <group key={position.join("-")} position={position}>
          <mesh castShadow position={[0, 0.32, 0]}>
            <boxGeometry args={[0.62, 0.64, 0.56]} />
            <meshStandardMaterial
              color={index % 2 === 0 ? "#f2b96f" : "#e78c75"}
              roughness={0.75}
            />
          </mesh>
          <mesh castShadow position={[0, 0.78, 0]} rotation-y={Math.PI / 4}>
            <coneGeometry args={[0.46, 0.34, 4]} />
            <meshStandardMaterial color="#fff0ce" roughness={0.82} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CircularLoop({ reducedMotion }: { reducedMotion: boolean }) {
  const rails = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!rails.current || reducedMotion) return;
    rails.current.rotation.y = Math.sin(clock.getElapsedTime() * 0.2) * 0.012;
  });

  return (
    <group ref={rails}>
      <mesh position={[0, 0.055, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[6.05, 0.43, 12, 80]} />
        <meshStandardMaterial color="#34464b" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.075, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[6.05, 0.055, 8, 80]} />
        <meshStandardMaterial
          color="#f0cd73"
          emissive="#80692f"
          emissiveIntensity={0.18}
        />
      </mesh>
      <mesh position={[0, 0.08, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[5.58, 0.045, 8, 80]} />
        <meshStandardMaterial
          color="#c5d4d6"
          metalness={0.52}
          roughness={0.35}
        />
      </mesh>
    </group>
  );
}

function AmbientTraffic({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group>
      <TrafficVehicle phase={0} reducedMotion={reducedMotion} color="#ffd37c" />
      <TrafficVehicle
        phase={Math.PI * 0.72}
        reducedMotion={reducedMotion}
        color="#ffb58a"
      />
      <TrafficVehicle
        phase={Math.PI * 1.42}
        reducedMotion={reducedMotion}
        color="#8ad3ff"
      />
    </group>
  );
}

function TrafficVehicle({
  phase,
  reducedMotion,
  color,
}: {
  phase: number;
  reducedMotion: boolean;
  color: string;
}) {
  const vehicle = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!vehicle.current) return;
    const theta = reducedMotion
      ? phase
      : clock.getElapsedTime() * 0.28 + phase;
    const radius = 6.05;
    vehicle.current.position.set(
      Math.cos(theta) * radius,
      0.22,
      Math.sin(theta) * radius,
    );
    vehicle.current.rotation.y = -theta + Math.PI / 2;
  });

  return (
    <group ref={vehicle}>
      <mesh castShadow>
        <boxGeometry args={[0.35, 0.16, 0.22]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
      <mesh position={[-0.1, -0.11, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.05, 0.05, 0.06, 10]} />
        <meshStandardMaterial color="#2f4048" roughness={0.5} />
      </mesh>
      <mesh position={[0.1, -0.11, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.05, 0.05, 0.06, 10]} />
        <meshStandardMaterial color="#2f4048" roughness={0.5} />
      </mesh>
    </group>
  );
}

function PedestrianFlow({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <group>
      <Pedestrian
        color="#f7f2dd"
        from={[-3.9, 0.08, -1.8]}
        to={[-2.9, 0.08, -2.6]}
        phase={0}
        reducedMotion={reducedMotion}
      />
      <Pedestrian
        color="#f9d5b5"
        from={[2.4, 0.08, -2.5]}
        to={[3.5, 0.08, -3.2]}
        phase={Math.PI * 0.4}
        reducedMotion={reducedMotion}
      />
      <Pedestrian
        color="#d6f0e4"
        from={[3.2, 0.08, 1.4]}
        to={[4.1, 0.08, 1.9]}
        phase={Math.PI * 0.8}
        reducedMotion={reducedMotion}
      />
    </group>
  );
}

function Pedestrian({
  color,
  from,
  to,
  phase,
  reducedMotion,
}: {
  color: string;
  from: Position;
  to: Position;
  phase: number;
  reducedMotion: boolean;
}) {
  const walker = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!walker.current) return;
    const wave = reducedMotion
      ? 0.5
      : (Math.sin(clock.getElapsedTime() * 0.6 + phase) + 1) / 2;
    walker.current.position.set(
      from[0] + (to[0] - from[0]) * wave,
      0.12,
      from[2] + (to[2] - from[2]) * wave,
    );
    walker.current.rotation.y = Math.atan2(to[0] - from[0], to[2] - from[2]);
  });

  return (
    <group ref={walker}>
      <mesh castShadow position={[0, 0.18, 0]}>
        <capsuleGeometry args={[0.06, 0.16, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.72} />
      </mesh>
      <mesh castShadow position={[0, 0.34, 0]}>
        <sphereGeometry args={[0.07, 10, 10]} />
        <meshStandardMaterial color="#f2c8a0" roughness={0.75} />
      </mesh>
    </group>
  );
}

function Facility({
  active,
  color,
  interactive,
  label,
  onSelect,
  position,
  selected,
  variant,
}: {
  active: boolean;
  color: string;
  interactive: boolean;
  label: string;
  onSelect: () => void;
  position: Position;
  selected: boolean;
  variant: "municipality" | "mrf" | "broker" | "warehouse" | "closed";
}) {
  const beacon = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!beacon.current || !active) return;
    const scale = 1 + Math.sin(clock.getElapsedTime() * 3) * 0.06;
    beacon.current.scale.setScalar(scale);
  });
  const buildingHeight =
    variant === "mrf"
      ? 1.5
      : variant === "warehouse"
        ? 0.82
        : variant === "closed"
          ? 0.56
          : 1.15;

  return (
    <group
      onClick={(event) => {
        event.stopPropagation();
        if (interactive) onSelect();
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
      onPointerOver={() => {
        document.body.style.cursor = interactive ? "pointer" : "not-allowed";
      }}
      position={position}
    >
      <group ref={beacon}>
        <mesh position={[0, 0.09, 0]} rotation-x={-Math.PI / 2}>
          <ringGeometry args={[1.12, selected ? 1.55 : 1.34, 32]} />
          <meshBasicMaterial
            color={selected ? "#fff0a8" : color}
            opacity={selected ? 0.95 : 0.55}
            transparent
          />
        </mesh>
      </group>
      <mesh castShadow position={[0, buildingHeight / 2, 0]}>
        <boxGeometry
          args={[
            variant === "warehouse" ? 2.35 : 1.82,
            buildingHeight,
            variant === "warehouse" ? 1.72 : 1.44,
          ]}
        />
        <meshStandardMaterial color={color} roughness={0.58} />
      </mesh>
      {variant !== "warehouse" && variant !== "closed" && (
        <mesh
          castShadow
          position={[0, buildingHeight + 0.17, 0]}
          rotation-y={Math.PI / 4}
        >
          <coneGeometry args={[0.94, 0.48, 4]} />
          <meshStandardMaterial color="#fff0cf" roughness={0.74} />
        </mesh>
      )}
      {variant === "municipality" && (
        <group>
          <mesh castShadow position={[0, buildingHeight + 0.45, 0]}>
            <cylinderGeometry args={[0.28, 0.4, 0.42, 16]} />
            <meshStandardMaterial color="#f6dfa4" roughness={0.7} />
          </mesh>
          {[-0.56, 0, 0.56].map((offset) => (
            <mesh key={offset} position={[offset, 0.46, 0.75]}>
              <boxGeometry args={[0.13, 0.52, 0.12]} />
              <meshStandardMaterial color="#e8f6ec" roughness={0.65} />
            </mesh>
          ))}
        </group>
      )}
      {variant === "mrf" && (
        <mesh castShadow position={[1.1, 0.48, 0]}>
          <cylinderGeometry args={[0.32, 0.39, 0.94, 12]} />
          <meshStandardMaterial
            color="#e8f1f2"
            metalness={0.45}
            roughness={0.42}
          />
        </mesh>
      )}
      {variant === "broker" && (
        <mesh castShadow position={[0, buildingHeight + 0.66, 0]}>
          <octahedronGeometry args={[0.35, 0]} />
          <meshStandardMaterial
            color="#ffe28b"
            emissive="#dd9b36"
            emissiveIntensity={0.34}
          />
        </mesh>
      )}
      {variant === "warehouse" && (
        <group>
          <mesh castShadow position={[0, buildingHeight + 0.18, 0]}>
            <boxGeometry args={[2.46, 0.24, 1.82]} />
            <meshStandardMaterial color="#fff0cf" roughness={0.82} />
          </mesh>
          {[-0.72, 0, 0.72].map((offset) => (
            <mesh key={offset} position={[offset, 0.32, 0.9]}>
              <boxGeometry args={[0.48, 0.5, 0.12]} />
              <meshStandardMaterial color="#5e4939" roughness={0.78} />
            </mesh>
          ))}
        </group>
      )}
      {variant === "closed" && (
        <group>
          <mesh position={[0, buildingHeight + 0.18, 0]} rotation-z={-0.18}>
            <boxGeometry args={[2.15, 0.08, 1.62]} />
            <meshStandardMaterial color="#a7aeb4" roughness={0.95} />
          </mesh>
          {[-0.72, 0.72].map((offset) => (
            <mesh key={offset} position={[offset, 0.28, 0.86]}>
              <boxGeometry args={[0.12, 0.56, 0.1]} />
              <meshStandardMaterial color="#f2b24d" roughness={0.7} />
            </mesh>
          ))}
        </group>
      )}
      <FacilityPlaque color={color} label={label} position={[0, 0.2, 0.86]} />
    </group>
  );
}

function FacilityPlaque({
  color,
  label,
  position,
}: {
  color: string;
  label: string;
  position: Position;
}) {
  const width = Math.max(0.72, Math.min(1.3, label.length / 11));
  return (
    <group position={position}>
      <mesh>
        <boxGeometry args={[width, 0.13, 0.065]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
        />
      </mesh>
    </group>
  );
}

function InventorySilos({
  inventoryKg,
}: {
  inventoryKg: CityRenderModel["inventoryKg"];
}) {
  const materials = Object.entries(inventoryKg) as Array<[Material, number]>;
  return (
    <group position={[1.65, 0, -3.7]}>
      {materials.map(([material, kilograms], index) => {
        const height = 0.28 + Math.min(1.25, kilograms / 7_000);
        return (
          <group key={material} position={[index * 0.46 - 0.92, 0, 0]}>
            <mesh castShadow position={[0, height / 2, 0]}>
              <cylinderGeometry args={[0.16, 0.19, height, 12]} />
              <meshStandardMaterial
                color={materialColors[material]}
                roughness={0.52}
              />
            </mesh>
            <mesh position={[0, height + 0.04, 0]}>
              <sphereGeometry args={[0.1, 10, 10]} />
              <meshStandardMaterial
                color="#fff6d7"
                emissive={materialColors[material]}
                emissiveIntensity={0.28}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function ProjectPlot({
  project,
  position,
  reducedMotion,
}: {
  project: CityProject;
  position: Position;
  reducedMotion: boolean;
}) {
  const marker = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!marker.current || reducedMotion || project.status !== "active") return;
    marker.current.position.y =
      0.1 + Math.sin(clock.getElapsedTime() * 2.5 + project.sequence) * 0.09;
  });
  const color = projectColor[project.status];

  return (
    <group position={position}>
      <mesh position={[0, 0.04, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.53, 20]} />
        <meshStandardMaterial color="#e6efdf" roughness={0.9} />
      </mesh>
      <group ref={marker} position={[0, 0.1, 0]}>
        <mesh castShadow>
          {project.status === "claimed" ? (
            <boxGeometry args={[0.52, 0.74, 0.52]} />
          ) : (
            <octahedronGeometry args={[0.3 + project.tier * 0.025, 0]} />
          )}
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={project.status === "active" ? 0.46 : 0.16}
            roughness={0.5}
          />
        </mesh>
      </group>
    </group>
  );
}

function TransitMarker({
  reducedMotion,
  transit,
}: {
  reducedMotion: boolean;
  transit: CityTransit;
}) {
  const marker = useRef<Group>(null);
  const [start, end]: [Position, Position] =
    transit.kind === "collection"
      ? [[-5.1, 0.48, 1.3], [-1.1, 0.58, -4.1]]
      : transit.kind === "processing"
        ? [[-2.1, 0.6, -4.0], [1.4, 0.58, 2.6]]
        : [[5.3, 0.56, -1.4], [1.7, 0.54, 2.7]];
  const durationMs =
    transit.route === "express"
      ? 6_000
      : transit.route === "consolidated" || transit.route === "low-carbon"
        ? 15_000
        : 10_000;

  useFrame(({ clock }) => {
    if (!marker.current) return;
    const remainingMs = Math.max(0, transit.arrivesAt - Date.now());
    const progress = reducedMotion
      ? 0.62
      : Math.max(0.08, Math.min(0.96, 1 - remainingMs / durationMs));
    marker.current.position.set(
      start[0] + (end[0] - start[0]) * progress,
      start[1] +
        (end[1] - start[1]) * progress +
        (reducedMotion ? 0 : Math.sin(clock.getElapsedTime() * 5) * 0.05),
      start[2] + (end[2] - start[2]) * progress,
    );
  });

  const color = transit.material ? materialColors[transit.material] : "#f5cb67";
  return (
    <group ref={marker}>
      <mesh castShadow>
        <boxGeometry args={[0.4, 0.26, 0.36]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.28}
          roughness={0.42}
        />
      </mesh>
      <mesh position={[-0.13, -0.18, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.09, 0.09, 0.08, 12]} />
        <meshStandardMaterial color="#2f4048" roughness={0.5} />
      </mesh>
      <mesh position={[0.13, -0.18, 0]} rotation-z={Math.PI / 2}>
        <cylinderGeometry args={[0.09, 0.09, 0.08, 12]} />
        <meshStandardMaterial color="#2f4048" roughness={0.5} />
      </mesh>
    </group>
  );
}

function TransferEffectMarker({
  effect,
  reducedMotion,
}: {
  effect: CityTransferEffect;
  reducedMotion: boolean;
}) {
  const marker = useRef<Group>(null);
  const [start, end]: [Position, Position] =
    effect.kind === "processed-material"
      ? [[-2.1, 0.66, -4.0], [1.6, 0.66, 2.75]]
      : effect.kind === "external-purchase"
        ? [[5.2, 0.64, -1.3], [1.6, 0.66, 2.75]]
        : effect.kind === "trade-delivery"
          ? [[7.8, 0.68, 0.9], [1.8, 0.66, 2.8]]
          : [[1.6, 0.64, 2.75], [-5.2, 0.64, 1.25]];

  useFrame(({ clock }) => {
    if (!marker.current) return;
    const elapsedMs = Math.max(0, Date.now() - effect.createdAt);
    const progress = reducedMotion
      ? 0.6
      : Math.max(0, Math.min(1, elapsedMs / Math.max(1, effect.durationMs)));
    marker.current.position.set(
      start[0] + (end[0] - start[0]) * progress,
      start[1] + (end[1] - start[1]) * progress + (1 - progress) * progress * 0.9,
      start[2] + (end[2] - start[2]) * progress,
    );
    marker.current.scale.setScalar(0.72 + (1 - progress) * 0.32);
    if (!reducedMotion) {
      marker.current.rotation.y = clock.getElapsedTime() * 3.8;
    }
  });

  const color = effect.material ? materialColors[effect.material] : "#fff0ad";
  return (
    <group ref={marker}>
      <mesh castShadow>
        <dodecahedronGeometry args={[0.22, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.42}
          roughness={0.45}
        />
      </mesh>
      <mesh rotation-x={Math.PI / 2}>
        <ringGeometry args={[0.25, 0.33, 18]} />
        <meshBasicMaterial color={color} opacity={0.7} transparent />
      </mesh>
    </group>
  );
}

function CityFallback({
  model,
  onSelectFacility,
  selectedFacility,
}: {
  model: CityRenderModel;
  onSelectFacility: (facility: CityFacility) => void;
  selectedFacility: CityFacility;
}) {
  return (
    <section
      className={`${styles.cityStage} ${styles.fallbackStage}`}
      aria-label="Shared circular city fallback"
    >
      <div className={styles.fallbackLoop} aria-hidden="true" />
      <div className={styles.fallbackFacilities}>
        {facilities.map((facility) => (
          <button
            aria-pressed={selectedFacility === facility.id}
            className={styles.fallbackFacility}
            data-facility={facility.id}
            disabled={
              facility.id === "future-site" ||
              (facility.id !== "warehouse" && facility.id !== model.role)
            }
            key={facility.id}
            onClick={() => onSelectFacility(facility.id)}
            style={facilityColorStyle(facility.color)}
            type="button"
          >
            <span />
            <strong>{facility.label}</strong>
            <small>{facility.description}</small>
          </button>
        ))}
      </div>
      <p className={styles.fallbackNotice}>
        Accessible city view active. {model.waste.available} collection sources,{" "}
        {model.waste.queued}
        MRF batches, and {model.activeTradeCount} active trades.
      </p>
    </section>
  );
}
