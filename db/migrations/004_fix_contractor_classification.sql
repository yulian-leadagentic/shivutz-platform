-- Migration 004: Fix contractor classification ENUM values
-- Old values: small/medium/large/enterprise (size-based)
-- New values: general/specialty/infrastructure (type-based, matches Israeli contractor licensing)
-- Date: 2026-04-04

USE org_db;

-- Step 1: Relax to VARCHAR so existing data doesn't truncate
ALTER TABLE contractors MODIFY COLUMN classification VARCHAR(50) NOT NULL DEFAULT 'general';
-- Step 2: Migrate old size-based values to type-based
UPDATE contractors SET classification = 'general'
  WHERE classification IN ('small','medium','large','enterprise');
-- Step 3: Re-apply ENUM with correct values
ALTER TABLE contractors
  MODIFY COLUMN classification
    ENUM('general','specialty','infrastructure','subcontractor','design_build')
    NOT NULL DEFAULT 'general';

-- Make contact_email optional (phone-first registration doesn't always have email)
ALTER TABLE contractors  MODIFY COLUMN contact_email VARCHAR(255) NULL;
ALTER TABLE corporations MODIFY COLUMN contact_email VARCHAR(255) NULL;
