# SMART CLINIC
It is an queue optimization platform that dynamically schedules consultations to reduce waiting time and maximize clinic efficiency.

# 1. Problem Statement
 # Problem Title
The Waiting Room That Never Moves

# Problem Discription
Long waiting times in hospitals and clinics create frustration for patients and inefficiency for medical staff. Most clinics use a fixed first-come-first-serve system that does not adapt to:

Emergency cases

Varying consultation durations

Doctor availability changes

No-shows or cancellations

This leads to:

Overcrowded waiting rooms

Increased patient dissatisfaction

Poor resource utilization

There is a need for a smarter system that dynamically manages patient queues in real time.

 # Target Users

1. Private clinics

2. Hospitals

3.Diagnostic centers

4.Medical reception staff

5. Doctors managing high patient flow

6 .Patients waiting for consultation

# exissting gaps

1.Most clinics follow static queue systems.

2.No dynamic adjustment for emergency cases.

3.Waiting time is unpredictable.

4.No real-time optimization based on consultation duration.

5.Manual queue management leads to inefficiency.

# 2. Problem Understanding & Approach

# Root Cause Analysis
The major causes of long waiting times in clinics are:

Static First-Come-First-Serve Model
Most clinics follow a fixed queue system that does not adjust dynamically.

No Structured Priority Handling
Emergency or high-priority patients disrupt the system manually.

Variable Consultation Durations
Different patients require different time, but this is not considered in scheduling.

Manual Queue Management
Reception staff manage queues manually, increasing chances of errors.

No Real-Time Updates
Patients are unaware of updated waiting times or queue position.

These issues lead to overcrowding, inefficient resource utilization, and patient dissatisfaction.

# Solution Strategy

Our strategy is to build a rule-based dynamic scheduling system that:

Assigns priority levels to patients

Reorders the queue automatically

Updates waiting time in real time

Optimizes doctor workload

Instead of relying on complex AI models, the system uses structured decision rules and priority sorting to improve efficiency.

# 3. Proposed Solution

# Solution Overview

The Waiting Room That Never Moves is a real-time patient queue optimization platform that dynamically schedules consultations using rule-based prioritization.

The system:

Collects patient details

Assigns priority based on predefined rules

Automatically sorts the queue

Updates waiting times instantly

# Core Idea

The core idea is to replace the traditional static queue system with a dynamic, rule-based scheduling mechanism.

Each patient is assigned a priority score based on:

Type of visit (Emergency / Regular / Follow-up)

Estimated consultation duration

Arrival time

# Key Features

Real-time queue reordering

Structured priority handling

Waiting time estimation

Automatic queue updates

User-friendly interface

Rule-based scheduling logic

Improved clinic efficiency

#  System Architecture
# High-Level Flow

User → Frontend → Backend → Scheduling Logic → Database → Response

# Architecture Description

Our system follows a simple client-server architecture with dynamic queue processing.

# Architecture Diagram 

https://www.researchgate.net/publication/371131312/figure/fig1/AS%3A11431281162578042%401685370097903/The-frontend-backend-and-database-of-a-web-based-application.jpg

# 5. Dataset Selected
# Dataset Name

Synthetic Clinic Consultation Dataset

# Source
Hugging Face ,a kaggle
Data Type
Structured tabular dataset (CSV)

# Selection Reason

Real clinic data is sensitive and hard to access

Allows modeling variability in consultation time

Enables training and testing without privacy concerns

Preprocessing Steps

Removed missing or inconsistent entries

Encoded categorical variables (visit type, urgency)

Normalized consultation duration

Feature engineering (arrival delay, doctor workload)

# 7.⁠ ⁠Model Selected
# Model Name
Gradient Boosting Regressor (Consultation Time Prediction)

Selection Reasoning

High accuracy for tabular healthcare data

Handles nonlinear relationships

Works well with small-to-medium datasets

Alternatives Considered

Random Forest Regressor

Linear Regression

Neural Networks (rejected due to small dataset)

Evaluation Metrics

# 8.⁠ ⁠Technology Stack
HTML,CSS (responsive dashboard UI)

Backend
node.js

Database
PostgreSQL (structured clinic and queue data)

Deployment
Docker + Cloud hosting (AWS / Render / Railway)
