UPDATE inventory_parts
SET category = CASE
  WHEN lower(name) LIKE '%esp32-cam%' OR lower(name) LIKE '%camera%' OR lower(name) LIKE '%ov2640%' THEN 'Cameras & Vision'
  WHEN lower(name) LIKE '%battery holder%' OR lower(name) LIKE '%bms%' OR lower(name) LIKE '%buck converter%' OR lower(name) LIKE '%boost converter%' OR lower(name) LIKE '%charger%' THEN 'Power Management'
  WHEN lower(name) LIKE '%battery%' OR lower(name) LIKE '%18650%' OR lower(name) LIKE '%lipo%' OR lower(name) LIKE '%power bank%' THEN 'Power Sources'
  WHEN category = 'Boards' THEN 'Microcontrollers & Compute'
  WHEN category = 'Actuators' THEN 'Motors & Actuators'
  WHEN category = 'Drivers' THEN 'Motor Drivers & Power Drivers'
  WHEN category = 'Displays' THEN 'Displays & Indicators'
  WHEN category = 'Communication' THEN 'Communication Modules'
  WHEN category = 'Power' THEN 'Power Management'
  WHEN category = 'Passives' THEN 'Passive Components'
  WHEN category = 'Interconnects' THEN 'Wiring & Connectors'
  WHEN category IN ('Prototyping', 'Prototyping & Assembly') THEN 'Prototyping & PCB'
  WHEN category = 'Tools' THEN 'Tools & Test Equipment'
  WHEN category IN ('Other', 'Others') THEN 'Others'
  WHEN category IN (
    'Microcontrollers & Compute', 'Sensors', 'Cameras & Vision', 'Motors & Actuators',
    'Motor Drivers & Power Drivers', 'Power Sources', 'Power Management',
    'Communication Modules', 'Displays & Indicators', 'Input & Controls',
    'Passive Components', 'Active Components', 'Prototyping & PCB',
    'Wiring & Connectors', 'Mechanical / Robotics', 'Fasteners & Mounting',
    'Tools & Test Equipment', 'Consumables', 'Storage / Spare Parts'
  ) THEN category
  ELSE 'Others'
END,
updated_at = CURRENT_TIMESTAMP;
