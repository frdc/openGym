// Alternative equipment labels reviewed against the exercise names, instructions and media.
// Source: https://www.movement.com.br/produtos/profissionais/ (reviewed 2026-10-11).
// Keep this overlay separate from the generated dataset so refreshes preserve the approved aliases.
// Split dual-machine labels by movement; omit uncertain matches and generic multiuse stations.
// IDs in the comments identify the source products in the reviewed Movement catalogue.
export const EXERCISE_MACHINE_ALIASES = {
  // 45° side bend; Movement 13205, 14876
  '0002': ["Banco Lombar"],
  // assisted chest dip (kneeling); Movement 14780
  '0009': ["Graviton"],
  // assisted parallel close grip pull-up; Movement 14780
  '0015': ["Graviton"],
  // assisted pull-up; Movement 14780
  '0017': ["Graviton"],
  // assisted triceps dip (kneeling); Movement 14780
  '0019': ["Graviton"],
  // barbell bench press; Movement 13091, 14869
  '0025': ["Banco Reto", "Olympic Flat Bench"],
  // barbell close-grip bench press; Movement 13091, 14869
  '0030': ["Banco Reto", "Olympic Flat Bench"],
  // barbell decline bench press; Movement 18435
  '0033': ["Olympic Decline Bench"],
  // barbell decline wide-grip press; Movement 18435
  '0036': ["Olympic Decline Bench"],
  // barbell guillotine bench press; Movement 13091, 14869
  '0045': ["Banco Reto", "Olympic Flat Bench"],
  // barbell incline bench press; Movement 13080, 14730
  '0047': ["Banco Inclinado", "Olympic Incline Bench"],
  // barbell incline reverse-grip press; Movement 13080, 14730
  '0048': ["Banco Inclinado", "Olympic Incline Bench"],
  // barbell preacher curl; Movement 13201, 14703
  '0070': ["Banco Bíceps"],
  // barbell reverse preacher curl; Movement 13201, 14703
  '0081': ["Banco Bíceps"],
  // barbell wide bench press; Movement 13091, 14869
  '0122': ["Banco Reto", "Olympic Flat Bench"],
  // cable low fly; Movement 14769
  '0179': ["Crossover"],
  // cable low seated row; Movement 17039, 17897, 19336
  '0180': ["Low Row"],
  // cable middle fly; Movement 14769
  '0188': ["Crossover"],
  // cable pulldown; Movement 17039, 17897, 19336
  '0198': ["Pulldown"],
  // cable seated crunch; Movement 16851
  '0212': ["Abdominal", "Abdominal New Idea"],
  // cable standing fly; Movement 14769
  '0227': ["Crossover"],
  // cable straight back seated row; Movement 17039, 17897, 19336
  '0239': ["Low Row"],
  // chest dip; Movement 14719
  '0251': ["Barras Paralelas"],
  // decline sit-up; Movement 13191, 14709, 16493
  '0282': ["Banco Abdominal", "Prancha Abdominal"],
  // dumbbell bench press; Movement 13091, 14869
  '0289': ["Banco Reto", "Olympic Flat Bench"],
  // dumbbell bench seated press; Movement 13182, 14752
  '0290': ["Banco 90"],
  // dumbbell decline bench press; Movement 18435
  '0301': ["Olympic Decline Bench"],
  // dumbbell decline hammer press; Movement 18435
  '0303': ["Olympic Decline Bench"],
  // dumbbell incline bench press; Movement 13080, 14730
  '0314': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell incline hammer press; Movement 13080, 14730
  '0321': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell incline palm-in press; Movement 13080, 14730
  '0324': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell lying hammer press; Movement 13091, 14869
  '0340': ["Banco Reto", "Olympic Flat Bench"],
  // dumbbell lying one arm press v. 2; Movement 13091, 14869
  '0342': ["Banco Reto", "Olympic Flat Bench"],
  // dumbbell lying one arm press; Movement 13091, 14869
  '0343': ["Banco Reto", "Olympic Flat Bench"],
  // dumbbell neutral grip bench press; Movement 13091, 14869
  '0352': ["Banco Reto", "Olympic Flat Bench"],
  // dumbbell one arm triceps extension (on bench); Movement 13182, 14752
  '0362': ["Banco 90"],
  // dumbbell preacher curl; Movement 13201, 14703
  '0372': ["Banco Bíceps"],
  // dumbbell reverse preacher curl; Movement 13201, 14703
  '0384': ["Banco Bíceps"],
  // dumbbell seated alternate press; Movement 13182, 14752
  '0388': ["Banco 90"],
  // dumbbell seated bench extension; Movement 13182, 14752
  '0389': ["Banco 90"],
  // dumbbell seated preacher curl; Movement 13201, 14703
  '0402': ["Banco Bíceps"],
  // dumbbell seated shoulder press (parallel grip); Movement 13182, 14752
  '0404': ["Banco 90"],
  // dumbbell seated shoulder press; Movement 13182, 14752
  '0405': ["Banco 90"],
  // ez barbell reverse grip preacher curl; Movement 13201, 14703
  '0452': ["Banco Bíceps"],
  // ez barbell seated triceps extension; Movement 13182, 14752
  '0453': ["Banco 90"],
  // hyperextension (on bench); Movement 13226
  '0488': ["Banco Romano"],
  // hyperextension; Movement 13205, 14876
  '0489': ["Banco Lombar"],
  // incline twisting sit-up; Movement 13191, 14709, 16493
  '0495': ["Banco Abdominal", "Prancha Abdominal"],
  // lever assisted chin-up; Movement 14780
  '0572': ["Graviton"],
  // lever back extension; Movement 16776, 17135
  '0573': ["Back Extension", "Back Extension New Idea", "Back Extension Next"],
  // lever chest press; Movement 17027, 17158, 19294
  '0576': ["Chest Press", "Chest Press Axis", "Chest Press New Idea", "Chest Press Next"],
  // lever chest press; Movement 17027, 17158, 19294
  '0577': ["Chest Press", "Chest Press Axis", "Chest Press New Idea", "Chest Press Next"],
  // lever front pulldown; Movement 17105, 17151, 19675
  '0579': ["Lat Pull", "Lat Pull Axis", "Pulldown", "Pulldown New Idea", "Pulldown Next"],
  // lever high row; Movement 16019
  '0581': ["High Row", "High Row Next"],
  // lever kneeling leg curl; Movement 16067
  '0582': ["Kneeling Leg Curl", "Kneeling Leg Curl Next"],
  // lever lateral raise; Movement 18902
  '0584': ["Seated Lateral Raise", "Seated Lateral Raise Next"],
  // lever leg extension; Movement 16846, 16847, 17137, 17893, 18407, 19304, 19314
  '0585': ["Leg Extension", "Leg Extension Axis", "Leg Extension New Idea", "Leg Extension Next", "Seated Leg Extension", "Seated Leg Extension Next"],
  // lever lying leg curl; Movement 16855, 17139, 19299
  '0586': ["Horizontal Leg Curl", "Horizontal Leg Curl Axis", "Leg Curl", "Leg Curl New Idea", "Leg Curl Next"],
  // lever military press; Movement 17003, 17156, 18390, 19363, 19538
  '0587': ["Incline Shoulder Press", "Incline Shoulder Press Axis", "Seated Shoulder Press", "Seated Shoulder Press Axis", "Shoulder Press", "Shoulder Press New Idea", "Seated Shoulder", "Seated Shoulder Next", "Shoulder Press Next"],
  // lever narrow grip seated row; Movement 16045, 16849, 17153, 19358, 19520
  '0588': ["Seated Row", "Seated Row Axis", "Row", "Row New Idea", "Low Row", "Low Row Next", "Row Next"],
  // lever overhand triceps dip; Movement 17007, 17161, 19373
  '0591': ["Triceps Press", "Triceps Press Axis", "Triceps Press New Idea", "Triceps Press Next"],
  // lever preacher curl; Movement 16852, 19289, 19549
  '0592': ["Biceps", "Biceps Axis", "Biceps Curl", "Biceps Curl Axis", "Biceps New Idea"],
  // lever seated calf raise; Movement 13209, 14802
  '0594': ["Banco Panturrilha", "Banco Panturrilha Next"],
  // lever seated fly; Movement 17043, 17149, 17896, 19329
  '0596': ["Pec Fly"],
  // lever seated hip abduction; Movement 17025, 17030, 17128, 17887, 19276, 19282
  '0597': ["Abductor", "Abductor Axis", "Abductor New Idea", "Abductor Next"],
  // lever seated hip adduction; Movement 17030, 17044, 17129, 17887, 19282, 19283
  '0598': ["Adductor", "Adductor Axis", "Adductor New Idea", "Adductor Next"],
  // lever seated leg curl; Movement 16839, 16847, 17142, 17893, 19314, 19349
  '0599': ["Seated Leg Curl", "Seated Leg Curl Axis", "Leg Curl", "Seated Leg Curl New Idea", "Seated Leg Curl Next"],
  // lever seated reverse fly; Movement 17043, 17149, 17896, 19329
  '0602': ["Rear Deltoid"],
  // lever t bar row; Movement 16265
  '0606': ["T-Bar Row", "T-Bar Row Next"],
  // sled 45° leg press; Movement 13126, 14819, 17895
  '0739': ["Leg Press 45º", "Leg Press 45º Axis LC", "Leg Press 45º Bolt", "Leg Press 45º Next"],
  // sled 45° leg wide press; Movement 13126, 14819, 17895
  '0740': ["Leg Press 45º", "Leg Press 45º Axis LC", "Leg Press 45º Bolt", "Leg Press 45º Next"],
  // triceps dip; Movement 14719
  '0814': ["Barras Paralelas"],
  // cable seated row; Movement 17039, 17897, 19336
  '0861': ["Low Row"],
  // lever shoulder press v. 2; Movement 17003, 17156, 18390, 19363, 19538
  '0869': ["Incline Shoulder Press", "Incline Shoulder Press Axis", "Seated Shoulder Press", "Seated Shoulder Press Axis", "Shoulder Press", "Shoulder Press New Idea", "Seated Shoulder", "Seated Shoulder Next", "Shoulder Press Next"],
  // barbell reverse grip decline bench press; Movement 18435
  '1256': ["Olympic Decline Bench"],
  // barbell reverse grip incline bench press; Movement 13080, 14730
  '1257': ["Banco Inclinado", "Olympic Incline Bench"],
  // barbell wide reverse grip bench press; Movement 13091, 14869
  '1258': ["Banco Reto", "Olympic Flat Bench"],
  // dumbbell incline one arm press; Movement 13080, 14730
  '1281': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell one arm decline chest press; Movement 18435
  '1287': ["Olympic Decline Bench"],
  // dumbbell one arm incline chest press; Movement 13080, 14730
  '1289': ["Banco Inclinado", "Olympic Incline Bench"],
  // lever incline chest press; Movement 16089, 19523
  '1299': ["Incline Chest Press", "Incline Chest Press Axis", "Incline Chest Press Next"],
  // lever decline chest press; Movement 16078
  '1300': ["Decline Chest Press", "Decline Chest Press Next"],
  // lever seated row; Movement 16045, 16849, 17153, 19358, 19520
  '1350': ["Seated Row", "Seated Row Axis", "Row", "Row New Idea", "Low Row", "Low Row Next", "Row Next"],
  // dumbbell one arm reverse preacher curl; Movement 13201, 14703
  '1414': ["Banco Bíceps"],
  // sled 45 degrees one leg press; Movement 13126, 14819, 17895
  '1425': ["Leg Press 45º", "Leg Press 45º Axis LC", "Leg Press 45º Bolt", "Leg Press 45º Next"],
  // chest dip (on dip-pull-up cage); Movement 14719
  '1430': ["Barras Paralelas"],
  // lever seated dip; Movement 17007, 17161, 19373
  '1451': ["Triceps Press", "Triceps Press Axis", "Triceps Press New Idea", "Triceps Press Next"],
  // lever seated crunch; Movement 17127
  '1452': ["Abdominal", "Abdominal Next"],
  // sled 45° leg press (side pov); Movement 13126, 14819, 17895
  '1463': ["Leg Press 45º", "Leg Press 45º Axis LC", "Leg Press 45º Bolt", "Leg Press 45º Next"],
  // sled 45° leg press (back pov); Movement 13126, 14819, 17895
  '1464': ["Leg Press 45º", "Leg Press 45º Axis LC", "Leg Press 45º Bolt", "Leg Press 45º Next"],
  // lever incline chest press v. 2; Movement 16089, 19523
  '1479': ["Incline Chest Press", "Incline Chest Press Axis", "Incline Chest Press Next"],
  // lever preacher curl v. 2; Movement 16852, 19289, 19549
  '1614': ["Biceps", "Biceps Axis", "Biceps Curl", "Biceps Curl Axis", "Biceps New Idea"],
  // dumbbell decline one arm hammer press; Movement 18435
  '1617': ["Olympic Decline Bench"],
  // dumbbell incline one arm hammer press; Movement 13080, 14730
  '1619': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell palms in incline bench press; Movement 13080, 14730
  '1623': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell reverse bench press; Movement 13091, 14869
  '1624': ["Banco Reto", "Olympic Flat Bench"],
  // ez barbell close grip preacher curl; Movement 13201, 14703
  '1627': ["Banco Bíceps"],
  // dumbbell alternate hammer preacher curl; Movement 13201, 14703
  '1646': ["Banco Bíceps"],
  // dumbbell alternate preacher curl; Movement 13201, 14703
  '1647': ["Banco Bíceps"],
  // dumbbell one arm hammer preacher curl; Movement 13201, 14703
  '1663': ["Banco Bíceps"],
  // barbell incline close grip bench press; Movement 13080, 14730
  '1719': ["Banco Inclinado", "Olympic Incline Bench"],
  // dumbbell twisting bench press; Movement 13091, 14869
  '1743': ["Banco Reto", "Olympic Flat Bench"],
  // barbell reverse close-grip bench press; Movement 13091, 14869
  '2187': ["Banco Reto", "Olympic Flat Bench"],
  // lever hip extension v. 2; Movement 17002, 17143, 18944
  '2286': ["Glute", "Glute New Idea", "Glute Next", "Standing Kick Back", "Standing Kick Back Next"],
  // lever calf press; Movement 17147
  '2289': ["Calf Extension", "Calf Extension Next"],
  // dumbbell zottman preacher curl; Movement 13201, 14703
  '2294': ["Banco Bíceps"],
  // lever rotary calf; Movement 17147
  '2315': ["Calf Extension", "Calf Extension Next"],
  // lever shoulder press v. 3; Movement 17003, 17156, 18390, 19363, 19538
  '2318': ["Incline Shoulder Press", "Incline Shoulder Press Axis", "Seated Shoulder Press", "Seated Shoulder Press Axis", "Shoulder Press", "Shoulder Press New Idea", "Seated Shoulder", "Seated Shoulder Next", "Shoulder Press Next"],
  // lever seated calf press; Movement 19352
  '2335': ["Calf Extension"],
  // lever horizontal one leg press; Movement 17028, 17145, 17894, 19352
  '2611': ["Seated Leg Press", "Seated Leg Press Axis LC", "Seated Leg Press New Idea", "Seated Leg Press Next"],
  // dumbbell incline alternate press; Movement 13080, 14730
  '3545': ["Banco Inclinado", "Olympic Incline Bench"],
  // weighted decline sit-up; Movement 13191, 14709, 16493
  '3670': ["Banco Abdominal", "Prancha Abdominal"],
  // lever seated crunch v. 2; Movement 17127
  '3760': ["Abdominal", "Abdominal Next"],
}
