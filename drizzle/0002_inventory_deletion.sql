ALTER TABLE inventory_parts ADD COLUMN location TEXT NOT NULL DEFAULT 'Unsorted';
ALTER TABLE inventory_parts ADD COLUMN code TEXT NOT NULL DEFAULT 'MODEL-UNKNOWN';

CREATE TABLE inventory_adjustment_events (
  id TEXT PRIMARY KEY NOT NULL,
  inventory_part_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_removed INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_inventory_adjustment_events_part_id ON inventory_adjustment_events(inventory_part_id);

INSERT OR IGNORE INTO inventory_parts (id,name,normalized_name,model,model_key,category,quantity,location,code,description,tags) VALUES
('seed-arduino-uno-r3','Arduino Uno R3','arduino uno r3',NULL,'__unknown__','Microcontrollers & Compute',3,'Bin A1','ARD-UNO','ATmega328P development board for rapid prototyping.','["5V","Digital","Analog"]'),
('seed-esp32-devkit-v1','ESP32 DevKit V1','esp32 devkit v1',NULL,'__unknown__','Microcontrollers & Compute',2,'Bin A2','ESP-32','Wi-Fi and Bluetooth enabled microcontroller board.','["Wi-Fi","Bluetooth","3.3V"]'),
('seed-dht22','DHT22','dht22',NULL,'__unknown__','Sensors',4,'Bin B1','SNS-DHT22','Digital temperature and humidity sensor.','["Temperature","Humidity","Digital"]'),
('seed-hc-sr04','HC-SR04','hc-sr04',NULL,'__unknown__','Sensors',6,'Bin B2','SNS-US04','Ultrasonic distance sensor with a 2–400 cm range.','["Distance","5V","Digital"]'),
('seed-pir-motion-sensor','PIR Motion Sensor','pir motion sensor',NULL,'__unknown__','Sensors',2,'Bin B3','SNS-PIR','Passive infrared sensor for detecting human motion.','["Motion","Digital","5V"]'),
('seed-l298n-motor-driver','L298N Motor Driver','l298n motor driver',NULL,'__unknown__','Motor Drivers & Power Drivers',2,'Bin C1','DRV-L298','Dual H-bridge driver for DC motors and steppers.','["Motor","12V","Dual channel"]'),
('seed-sg90-micro-servo','SG90 Micro Servo','sg90 micro servo',NULL,'__unknown__','Motors & Actuators',8,'Bin C2','ACT-SG90','Compact 180° positional servo for lightweight mechanisms.','["Servo","PWM","5V"]'),
('seed-soil-moisture-probe','Soil Moisture Probe','soil moisture probe',NULL,'__unknown__','Sensors',5,'Bin B4','SNS-SOIL','Analog probe for estimating soil moisture levels.','["Soil","Analog","Farm"]'),
('seed-mini-breadboard','Mini Breadboard','mini breadboard',NULL,'__unknown__','Prototyping & PCB',7,'Bin D1','PRT-BRD','170-point solderless board for compact circuits.','["Prototype","Reusable"]');
