# Engineering Spec v1 – AI Note App

## 1. Overview
This document defines the technical architecture, stack, and implementation guidelines.

---

## 2. Core Principles
- Local-first architecture
- On-device AI only (no cloud AI)
- Fast capture (<3s)
- AI failure must not block save
- Replaceable AI engine

---

## 3. Tech Stack

### Mobile App
- React Native
- Expo Prebuild
- TypeScript

### State
- Zustand

### Local DB
- SQLite

### Backend
- Supabase (Auth + Sync + Shared folders)

### Auth
- Google Login
- Kakao Login

---

## 4. Architecture

App Layers:

1. Capture Layer
- Share Intent (Android)
- Share Extension (iOS)
- Clipboard input
- URL/Text input

2. Parse Layer
- Metadata extraction
- Content normalization
- Image candidates

3. AI Layer
- Title generation
- Summary generation
- Thumbnail selection

4. Data Layer
- SQLite
- Sync queue

5. Sync Layer
- Supabase API
- Conflict resolution

---

## 5. Data Flow

Capture → Parse → AI → Local Save → Sync Queue → Server Sync

---

## 6. Database (Simplified)

Items:
- id
- type (url, text)
- title
- summary
- content
- url
- thumbnail
- folder_id

Folders:
- id
- name
- type (personal/shared)

Membership:
- user_id
- folder_id
- role

---

## 7. Sync Strategy
- Local-first
- Queue-based sync
- Last-write-wins conflict resolution

---

## 8. AI Engine Design

Interface:

generateTitle(input)
summarize(input)
pickThumbnail(data)

Requirements:
- Must run on-device
- Replaceable engine
- Fallback support

---

## 9. Project Structure

/src
  /features
  /components
  /screens
  /store
  /services
  /db
  /ai
  /sync

---

## 10. Coding Guidelines

- Keep logic modular
- Separate AI layer from UI
- Avoid tight coupling with specific AI engine
- Always implement fallback logic

---

## 11. Constraints

- No cloud AI
- Must support offline
- Must support Android + iOS
