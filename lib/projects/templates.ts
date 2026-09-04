import type { D1Like } from "../identification/persistence.ts";
import { normalizeIdentity } from "../identification/validation.ts";
import { createProject, existingProjectNames, listProjectPlans } from "./persistence.ts";
import type { CreateProjectInput, TemplateSeedResult } from "./types.ts";

/**
 * The five builds the Projects tab used to hardcode, turned into real records a
 * new cabinet starts from. Requirements leave the model unset: identification
 * files most parts with an unknown model, and a template that names a model the
 * catalogue never records would match nothing.
 */
export const PROJECT_TEMPLATES: CreateProjectInput[] = [
  {
    name: "Elderly monitoring camera",
    summary: "A room camera that watches for movement and keeps the footage in the house.",
    state: "planned",
    accent: "coral",
    icon: "CAM",
    nextStep: "Add local video storage",
    requirements: [
      { name: "ESP32-CAM", model: null, category: "Cameras & Vision", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "MicroSD Card Module", model: null, category: "Storage / Spare Parts", quantityRequired: 1, matchMode: "identity", note: "Records clips without a cloud account." },
      { name: "PIR Motion Sensor", model: null, category: "Sensors", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "5V 2A USB Power Supply", model: null, category: "Power Sources", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Jumper wires", model: null, category: "Wiring & Connectors", quantityRequired: 10, matchMode: "category", note: null },
    ],
  },
  {
    name: "Basic Arduino car",
    summary: "Two driven wheels, an ultrasonic eye, and enough battery to cross a room.",
    state: "planned",
    accent: "blue",
    icon: "CAR",
    nextStep: "Mount the motor driver",
    requirements: [
      { name: "Arduino Uno R3", model: null, category: "Microcontrollers & Compute", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "L298N Motor Driver", model: null, category: "Motor Drivers & Power Drivers", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "TT Gear Motor", model: null, category: "Motors & Actuators", quantityRequired: 2, matchMode: "identity", note: "One per driven wheel." },
      { name: "18650 Battery Holder", model: null, category: "Power Sources", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "HC-SR04", model: null, category: "Sensors", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Jumper wires", model: null, category: "Wiring & Connectors", quantityRequired: 20, matchMode: "category", note: null },
    ],
  },
  {
    name: "Mecanum wheel car",
    summary: "Four independently driven rollers, so the chassis can slide sideways.",
    state: "planned",
    accent: "purple",
    icon: "MEC",
    nextStep: "Source the drivetrain",
    requirements: [
      { name: "Mecanum Wheel", model: null, category: "Mechanical / Robotics", quantityRequired: 4, matchMode: "identity", note: "Two left-hand, two right-hand." },
      { name: "TT Gear Motor", model: null, category: "Motors & Actuators", quantityRequired: 4, matchMode: "identity", note: null },
      { name: "L298N Motor Driver", model: null, category: "Motor Drivers & Power Drivers", quantityRequired: 2, matchMode: "identity", note: "One driver per pair of motors." },
      { name: "ESP32 DevKit V1", model: null, category: "Microcontrollers & Compute", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Aluminium Chassis Plate", model: null, category: "Mechanical / Robotics", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "3S LiPo Battery", model: null, category: "Power Sources", quantityRequired: 1, matchMode: "identity", note: null },
    ],
  },
  {
    name: "4 DOF robot arm",
    summary: "Base, shoulder, elbow and gripper, driven from one servo board.",
    state: "planned",
    accent: "amber",
    icon: "ARM",
    nextStep: "Finish the joint calibration",
    requirements: [
      { name: "MG996R Servo", model: null, category: "Motors & Actuators", quantityRequired: 4, matchMode: "identity", note: "One per axis." },
      { name: "PCA9685 Servo Driver", model: null, category: "Motor Drivers & Power Drivers", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Arduino Uno R3", model: null, category: "Microcontrollers & Compute", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "5V 5A Power Supply", model: null, category: "Power Sources", quantityRequired: 1, matchMode: "identity", note: "Servos brown out on a USB port." },
      { name: "Claw Gripper", model: null, category: "Mechanical / Robotics", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Servo Bracket Set", model: null, category: "Fasteners & Mounting", quantityRequired: 1, matchMode: "identity", note: null },
    ],
  },
  {
    name: "Small urban indoor farm",
    summary: "Soil readings, a timed pump, and a grow light on a windowless shelf.",
    state: "planned",
    accent: "green",
    icon: "FARM",
    nextStep: "Automate the watering",
    requirements: [
      { name: "ESP32 DevKit V1", model: null, category: "Microcontrollers & Compute", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Soil Moisture Probe", model: null, category: "Sensors", quantityRequired: 3, matchMode: "identity", note: "One per planter." },
      { name: "DHT22", model: null, category: "Sensors", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "5V Relay Module", model: null, category: "Motor Drivers & Power Drivers", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "12V Water Pump", model: null, category: "Motors & Actuators", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "Full Spectrum Grow Light", model: null, category: "Displays & Indicators", quantityRequired: 1, matchMode: "identity", note: null },
      { name: "12V 2A Power Supply", model: null, category: "Power Sources", quantityRequired: 1, matchMode: "identity", note: null },
    ],
  },
];

/**
 * Idempotent: a template whose name the owner already holds is skipped and
 * reported, so seeding twice never fails and never duplicates a project.
 */
export async function seedProjectTemplates(ownerId: string, db: D1Like): Promise<TemplateSeedResult> {
  const held = await existingProjectNames(ownerId, db);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const template of PROJECT_TEMPLATES) {
    if (held.has(normalizeIdentity(template.name))) {
      skipped.push(template.name);
      continue;
    }
    await createProject(template, ownerId, db);
    created.push(template.name);
  }

  return { created, skipped, projects: await listProjectPlans(ownerId, db) };
}
