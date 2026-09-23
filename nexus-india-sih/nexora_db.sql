DROP TABLE IF EXISTS person_phones, phones, connections, vehicles, person_cases, cases, locations, persons CASCADE;

CREATE TABLE persons (
    person_id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    age INT,
    gender VARCHAR(20),
    city VARCHAR(100),
    state VARCHAR(100),
    occupation VARCHAR(100)
);

CREATE TABLE cases (
    case_id VARCHAR(20) PRIMARY KEY,
    crime_type VARCHAR(100),
    case_date DATE,
    location VARCHAR(150),
    arrest_status VARCHAR(50)
);

CREATE TABLE person_cases (
    person_id VARCHAR(20) REFERENCES persons(person_id),
    case_id VARCHAR(20) REFERENCES cases(case_id),
    PRIMARY KEY (person_id, case_id)
);

CREATE TABLE connections (
    connection_id SERIAL PRIMARY KEY,
    person_1 VARCHAR(20) REFERENCES persons(person_id),
    person_2 VARCHAR(20) REFERENCES persons(person_id),
    relationship VARCHAR(100),
    UNIQUE (person_1, person_2, relationship)
);

CREATE TABLE vehicles (
    vehicle_id VARCHAR(20) PRIMARY KEY,
    person_id VARCHAR(20) REFERENCES persons(person_id),
    vehicle_type VARCHAR(50),
    registration_no VARCHAR(30),
    notes VARCHAR(150)
);

CREATE TABLE phones (
    phone_id VARCHAR(20) PRIMARY KEY
);

CREATE TABLE person_phones (
    person_id VARCHAR(20) REFERENCES persons(person_id),
    phone_id VARCHAR(20) REFERENCES phones(phone_id),
    PRIMARY KEY (person_id, phone_id)
);

CREATE TABLE locations (
    location_id VARCHAR(20) PRIMARY KEY,
    city VARCHAR(100),
    state VARCHAR(100)
);

INSERT INTO persons (person_id, name, age, gender, city, state, occupation) VALUES
('P001', 'Rajesh Malhotra', 45, 'Male', 'Pune', 'Maharashtra', 'Warehouse owner'),
('P002', 'Amit Chauhan', 38, 'Male', 'Mumbai', 'Maharashtra', 'Freight agent'),
('P003', 'Sunita Agarwal', 42, 'Female', 'Indore', 'Madhya Pradesh', 'Jewellery trader'),
('P004', 'Manoj Tiwari', 33, 'Male', 'Nagpur', 'Maharashtra', 'Truck driver'),
('P005', 'Prakash Reddy', 36, 'Male', 'Hyderabad', 'Telangana', 'Logistics supervisor'),
('P006', 'Kavita Menon', 35, 'Female', 'Kochi', 'Kerala', 'Accountant'),
('P007', 'Faisal Ansari', 31, 'Male', 'Bengaluru', 'Karnataka', 'Mobile shop owner'),
('P008', 'Nikhil Verma', 27, 'Male', 'Delhi', 'Delhi', 'Call-centre agent'),
('P009', 'Deepika Sharma', 30, 'Female', 'Jaipur', 'Rajasthan', 'Freelance data-entry operator'),
('P010', 'Gurpreet Singh', 40, 'Male', 'Ludhiana', 'Punjab', 'Used vehicle dealer');

INSERT INTO cases (case_id, crime_type, case_date, location, arrest_status) VALUES
('C001', 'Drug trafficking (NDPS)', '2025-02-10', 'Chakan MIDC, Pune', 'Arrested'),
('C002', 'Smuggling of contraband', '2025-03-05', 'Nhava Sheva port, Mumbai', 'Absconding'),
('C003', 'Money laundering', '2025-04-18', 'Sarafa Bazaar, Indore', 'Under investigation'),
('C004', 'Illegal transport of contraband', '2025-05-22', 'NH-44, Nagpur-Hyderabad', 'Arrested'),
('C005', 'Smuggling of contraband', '2025-06-30', 'Shamshabad, Hyderabad', 'Arrested'),
('C006', 'Hawala / money laundering', '2025-07-14', 'Ernakulam, Kochi', 'Absconding'),
('C007', 'Illegal SIM card racket', '2025-08-09', 'Shivajinagar, Bengaluru', 'Arrested'),
('C008', 'Cyber fraud (KYC scam)', '2025-09-01', 'Laxmi Nagar, Delhi', 'Arrested'),
('C009', 'Identity theft and fake documents', '2025-10-12', 'Malviya Nagar, Jaipur', 'Under investigation'),
('C010', 'Vehicle theft and forged RC', '2025-11-20', 'Focal Point, Ludhiana', 'Arrested');

INSERT INTO person_cases (person_id, case_id) VALUES
('P001', 'C001'), ('P001', 'C002'), ('P002', 'C001'), ('P002', 'C002'),
('P003', 'C001'), ('P003', 'C003'), ('P004', 'C002'), ('P004', 'C004'),
('P005', 'C004'), ('P005', 'C005'), ('P006', 'C003'), ('P006', 'C006'),
('P007', 'C005'), ('P007', 'C006'), ('P007', 'C007'), ('P008', 'C007'),
('P008', 'C008'), ('P009', 'C008'), ('P009', 'C009'), ('P010', 'C001'),
('P010', 'C009'), ('P010', 'C010');

INSERT INTO connections (person_1, person_2, relationship) VALUES
('P001', 'P002', 'associate'), ('P001', 'P003', 'financer'),
('P001', 'P010', 'associate'), ('P002', 'P004', 'transporter'),
('P003', 'P006', 'financer'), ('P004', 'P005', 'transporter'),
('P005', 'P007', 'associate'), ('P006', 'P007', 'associate'),
('P007', 'P008', 'recruiter'), ('P008', 'P009', 'associate'),
('P009', 'P010', 'associate');

INSERT INTO vehicles (vehicle_id, person_id, vehicle_type, notes) VALUES
('V001', 'P001', 'Warehouse vehicle', 'Shared with P010'),
('V002', 'P002', 'Freight vehicle', NULL),
    ('V003', 'P004', 'Transport truck', 'Shared with P005'),
    ('V004', 'P007', 'Commercial vehicle', NULL),
    ('V005', 'P010', 'Used vehicle', 'Stolen'),
    ('V006', 'P010', 'Used vehicle', 'Stolen');

UPDATE vehicles SET person_id = 'P004' WHERE vehicle_id = 'V003';
UPDATE vehicles SET person_id = 'P007' WHERE vehicle_id = 'V004';
UPDATE vehicles SET person_id = 'P010' WHERE vehicle_id IN ('V005', 'V006');

INSERT INTO phones (phone_id) VALUES
('PH001'), ('PH002'), ('PH003'), ('PH004'), ('PH005'), ('PH006'),
('PH007'), ('PH008'), ('PH009'), ('PH010');

INSERT INTO person_phones (person_id, phone_id) VALUES
('P001', 'PH001'), ('P002', 'PH002'), ('P003', 'PH003'),
('P004', 'PH004'), ('P005', 'PH005'), ('P006', 'PH006'),
('P007', 'PH007'), ('P007', 'PH008'), ('P008', 'PH008'),
('P009', 'PH009'), ('P010', 'PH010');

INSERT INTO locations (location_id, city, state) VALUES
('L001', 'Pune', 'Maharashtra'), ('L002', 'Mumbai', 'Maharashtra'),
('L003', 'Indore', 'Madhya Pradesh'), ('L004', 'Nagpur', 'Maharashtra'),
('L005', 'Hyderabad', 'Telangana'), ('L006', 'Kochi', 'Kerala'),
('L007', 'Bengaluru', 'Karnataka'), ('L008', 'Delhi', 'Delhi'),
('L009', 'Jaipur', 'Rajasthan'), ('L010', 'Ludhiana', 'Punjab');