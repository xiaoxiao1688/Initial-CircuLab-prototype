window.CIRCUIT_DATA = {
  lessons: [
    {
      id: "loop",
      icon: "O",
      title: "闭合回路",
      summary: "电流要流动，必须从电源正极出发，再回到负极。",
      body: "一个基础电路至少要有电源、导线和负载。只要路径中断，元件就不会工作。",
      tip: "常见错误：只接到电池一端，或者忘了把回路接回负极。"
    },
    {
      id: "switch",
      icon: "S",
      title: "开关控制",
      summary: "开关决定电路是否导通。",
      body: "开关闭合时，两端导通；开关断开时，电流路径会被切断。",
      tip: "常见错误：把开关放进电路，但没有把两端都接入主回路。"
    },
    {
      id: "led",
      icon: "L",
      title: "LED 极性",
      summary: "LED 有正负极，方向接反时不会亮。",
      body: "在教学模型里，LED 正端应更靠近电源正极，负端最终要回到电源负极。",
      tip: "常见错误：把 LED 正负端接反，回路看起来闭合但判定仍会失败。"
    },
    {
      id: "parallel",
      icon: "P",
      title: "并联",
      summary: "并联支路共享同一对电源节点。",
      body: "并联时每个负载都能独立形成一条从正极到负极的回路，一条支路断开不会影响其他支路。",
      tip: "常见错误：误把两个负载首尾串起来，结果变成串联。"
    }
  ],
  components: [
    {
      id: "battery",
      name: "电池",
      description: "提供直流电源。",
      type: "power",
      ports: [
        { id: "positive", label: "正极" },
        { id: "negative", label: "负极" }
      ],
      tags: ["必选", "电源"]
    },
    {
      id: "wire",
      name: "导线",
      description: "连接两个端点，视为完全导通。",
      type: "wire",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["连接", "导通"]
    },
    {
      id: "switch",
      name: "开关",
      description: "教学版默认闭合，可用于控制回路是否导通。",
      type: "control",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["控制", "开合"]
    },
    {
      id: "resistor",
      name: "电阻",
      description: "限制电流，是 LED 实验中常见的保护元件。",
      type: "load",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["负载", "保护"]
    },
    {
      id: "led",
      name: "LED",
      description: "有方向的发光二极管。",
      type: "load",
      ports: [
        { id: "anode", label: "正端" },
        { id: "cathode", label: "负端" }
      ],
      tags: ["极性", "发光"]
    },
    {
      id: "lamp",
      name: "小灯泡",
      description: "无极性负载，适合做串并联对比。",
      type: "load",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["负载", "对比"]
    },
    {
      id: "motor",
      name: "电机",
      description: "双端电机负载，可用于电动回路演示。",
      type: "load",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["负载", "运动"]
    },
    {
      id: "fan",
      name: "风扇",
      description: "双端风扇模块，适合做执行器类演示。",
      type: "load",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["负载", "执行器"]
    },
    {
      id: "buzzer",
      name: "蜂鸣器",
      description: "双端发声负载，可接入基础闭合回路。",
      type: "load",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["负载", "声音"]
    },
    {
      id: "capacitor",
      name: "电容",
      description: "基础双端电容模型，可用于元件识别和装配。",
      type: "passive",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["无源", "储能"]
    },
    {
      id: "fuse",
      name: "保险丝",
      description: "双端保护元件，可用于保护回路示意。",
      type: "passive",
      ports: [
        { id: "a", label: "A 端" },
        { id: "b", label: "B 端" }
      ],
      tags: ["无源", "保护"]
    }
  ],
  levels: [
    {
      id: "level-1",
      title: "第 1 关 让 LED 亮起来",
      description: "搭一个最基础的 LED 闭合回路，理解电源正负极和 LED 极性。",
      goals: [
        "包含 1 个电池和 1 个 LED",
        "从电池正极能走到 LED 正端",
        "从 LED 负端最终回到电池负极",
        "整个电路形成闭合回路"
      ],
      requiredTypes: ["battery", "led"],
      recommendedTypes: ["wire"],
      starterComponents: ["battery", "led", "wire", "wire"],
      successText: "你已经搭出了一个最小可工作的 LED 回路。",
      objective: "closed-led-loop"
    },
    {
      id: "level-2",
      title: "第 2 关 用开关控制 LED",
      description: "在闭合回路中串入开关，理解控制元件必须接在主路径上。",
      goals: [
        "包含电池、LED、开关",
        "主路径必须经过开关",
        "保持 LED 极性正确",
        "电路仍然闭合"
      ],
      requiredTypes: ["battery", "led", "switch"],
      recommendedTypes: ["wire"],
      starterComponents: ["battery", "switch", "led", "wire", "wire", "wire"],
      successText: "开关已经成功串入主回路，可以承担控制作用。",
      objective: "switch-controls-led"
    },
    {
      id: "level-3",
      title: "第 3 关 搭一个并联双灯电路",
      description: "让两个负载共享同一对电源节点，验证并联结构的特征。",
      goals: [
        "包含 1 个电池和 2 个负载",
        "两个负载都能各自形成从正极到负极的独立通路",
        "两个负载不能首尾串成一条单链"
      ],
      requiredTypes: ["battery"],
      recommendedTypes: ["lamp", "led", "wire"],
      starterComponents: ["battery", "lamp", "lamp", "wire", "wire", "wire", "wire"],
      successText: "你搭出了教学意义上的并联结构。",
      objective: "parallel-loads"
    },
    {
      id: "level-4",
      title: "第 4 关 给 LED 串联保护电阻",
      description: "在 LED 回路里串入电阻，理解电阻应放在主路径上，不能被旁路绕过。",
      goals: [
        "包含电池、电阻和 LED",
        "从电池正极到 LED 正端的路径必须经过电阻",
        "LED 负端最终回到电池负极",
        "不能存在绕过电阻直达 LED 的旁路"
      ],
      requiredTypes: ["battery", "resistor", "led"],
      recommendedTypes: ["wire"],
      starterComponents: ["battery", "resistor", "led", "wire", "wire", "wire"],
      successText: "你已经把电阻正确串入 LED 主回路，形成了更合理的保护结构。",
      objective: "resistor-protects-led"
    }
  ]
};
