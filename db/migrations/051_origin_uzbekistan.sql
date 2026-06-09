-- 051: add Uzbekistan to origin_countries
--
-- Product asked for an additional origin country on the contractor's
-- search form + worker registration. UZ joins the existing active
-- set; admin can toggle is_active later if needed.

USE worker_db;

INSERT IGNORE INTO origin_countries (code, name_he, name_en, is_active)
VALUES ('UZ', 'אוזבקיסטן', 'Uzbekistan', 1);
