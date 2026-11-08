-- 本地开发库和测试库（线上在云托管 MySQL 页面建库时同样要选 utf8mb4 / utf8mb4_0900_ai_ci）
CREATE DATABASE IF NOT EXISTS mother_baby DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE IF NOT EXISTS mother_baby_test DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
