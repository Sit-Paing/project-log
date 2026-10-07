-- Optional: the BM3 job from the paper schedule. Safe to run once.
INSERT OR IGNORE INTO projects (id, name, client, po, created_at)
VALUES ('bm3-clamping-gap', 'BM3 reduce mold clamping gap', '', '4982427', 1791349000000);

INSERT OR IGNORE INTO tasks (id, project_id, grp, name, incharge, plan_start, plan_due, act_start, act_end, ord) VALUES
('t01','bm3-clamping-gap','ME Design','3D Design','Phitsanu','2026-10-03','2026-10-03','2026-10-03','2026-10-03',1010),
('t02','bm3-clamping-gap','ME Design','Drawing','Phitsanu','2026-10-03','2026-10-03','2026-10-03','2026-10-03',1020),
('t03','bm3-clamping-gap','ME Design','BOM','Phitsanu','2026-10-03','2026-10-03','2026-10-03','2026-10-03',1030),
('t04','bm3-clamping-gap','EE Design','EE Design','','','','','',2010),
('t05','bm3-clamping-gap','EE Design','Drawing','','','','','',2020),
('t06','bm3-clamping-gap','EE Design','BOM','','','','','',2030),
('t07','bm3-clamping-gap','Parts Order [PR]','Fab. Parts','Komsan','2026-10-05','2026-10-10','','',3010),
('t08','bm3-clamping-gap','Parts Order [PR]','Std. Parts','Komsan','2026-10-05','2026-10-10','','',3020),
('t09','bm3-clamping-gap','Automation','Assembly','','','','','',4010),
('t10','bm3-clamping-gap','Automation','Wiring','','','','','',4020),
('t11','bm3-clamping-gap','Automation','I/O Check','','','','','',4030),
('t12','bm3-clamping-gap','Automation','Programmable','','','','','',4040),
('t13','bm3-clamping-gap','Automation','Setup Finetune','','','','','',4050),
('t14','bm3-clamping-gap','Automation','Test Run','','','','','',4060),
('t15','bm3-clamping-gap','Automation','Delivery','','','','','',4070),
('t16','bm3-clamping-gap','Automation','Installation Setup','Komsan','2026-10-19','2026-10-19','','',4080),
('t17','bm3-clamping-gap','Automation','Handover / Train','','','','','',4090);
