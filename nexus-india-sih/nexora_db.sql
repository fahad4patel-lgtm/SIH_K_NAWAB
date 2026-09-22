CREATE TABLE persons (
    person_id VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    age INT,
    gender VARCHAR(20),
    city VARCHAR(100),
    occupation VARCHAR(100)
);

CREATE TABLE cases (
    case_id VARCHAR(20) PRIMARY KEY,
    crime_type VARCHAR(100),
    case_date DATE,
    location VARCHAR(100),
    arrest_status VARCHAR(50)
);

CREATE TABLE person_cases (
    person_id VARCHAR(20),
    case_id VARCHAR(20),
    PRIMARY KEY (person_id, case_id),
    FOREIGN KEY (person_id) REFERENCES persons(person_id),
    FOREIGN KEY (case_id) REFERENCES cases(case_id)
);

CREATE TABLE connections (
    connection_id SERIAL PRIMARY KEY,
    person_1 VARCHAR(20),
    person_2 VARCHAR(20),
    relationship VARCHAR(100),
    FOREIGN KEY (person_1) REFERENCES persons(person_id),
    FOREIGN KEY (person_2) REFERENCES persons(person_id)
);

CREATE TABLE vehicles (
    vehicle_id VARCHAR(20) PRIMARY KEY,
    person_id VARCHAR(20),
    vehicle_type VARCHAR(50),
    registration_no VARCHAR(30),
    FOREIGN KEY (person_id) REFERENCES persons(person_id)
);

CREATE TABLE locations (
    location_id VARCHAR(20) PRIMARY KEY,
    city VARCHAR(100),
    state VARCHAR(100)
);

INSERT INTO persons
(person_id, name, age, gender, city, occupation)
VALUES
('P001', 'Arman Khan', 29, 'Male', 'Pune', 'Transport Worker');

INSERT INTO cases
(case_id, crime_type, case_date, location, arrest_status)
VALUES
('C001', 'Human Trafficking', '2025-06-15', 'Pune', 'Arrested');

INSERT INTO person_cases
(person_id, case_id)
VALUES
('P001', 'C001');

SELECT * FROM persons;

SELECT * FROM cases;

SELECT * FROM person_cases;