(function () {
  const DEFAULT_SCAFFOLD = {
    startPrompt: "开始吧，做这道题目。先在实验台摆好元件并连线，再点击“验证电路”。",
    checkpoints: ["先确认元件齐全，再逐步检查主路径是否满足本关要求。"]
  };

  const OBJECTIVE_SCAFFOLDS = {
    "closed-led-loop": {
      startPrompt: "开始吧，做这道题目。先把电池、LED 和导线连成一个最基础的闭合回路。",
      checkpoints: [
        "先让电池正极能连到 LED 正端。",
        "再让 LED 负端回到电池负极。",
        "最后确认中间没有断路。"
      ]
    },
    "switch-controls-led": {
      startPrompt: "开始吧，做这道题目。把开关真正串进 LED 主回路，不要只把它摆在旁边。",
      checkpoints: [
        "正极到 LED 的主路径必须经过开关。",
        "LED 负端仍然要回到电池负极。",
        "不要出现绕过开关的旁路。"
      ]
    },
    "parallel-loads": {
      startPrompt: "开始吧，做这道题目。让两个负载共享同一对电源节点，搭出标准并联。",
      checkpoints: [
        "两个负载都要各自接到电池正极一侧。",
        "两个负载都要各自回到电池负极一侧。",
        "不要把两个负载首尾串成一条链。"
      ]
    },
    "resistor-protects-led": {
      startPrompt: "开始吧，做这道题目。目标是把电阻正确串入 LED 主回路：电池正极 → 电阻某一端 → 电阻另一端 → LED 正端 → LED 负端 → 电池负极。",
      checkpoints: [
        "电池正极能先到达电阻的某一端（A 端或 B 端）。",
        "电阻的另一端能到达 LED 正端（电阻必须被电流完整经过，不能只接一端）。",
        "LED 负端最终能回到电池负极，完成下半回路。",
        "不存在绕过电阻的旁路：如果电池正极侧和 LED 正端侧之间有不经过电阻的导线，电阻就失去保护意义了。"
      ]
    }
  };

  const OBJECTIVE_VALIDATORS = {
    "closed-led-loop": evaluateLedLoop,
    "switch-controls-led": evaluateSwitchLevel,
    "parallel-loads": evaluateParallelLevel,
    "resistor-protects-led": evaluateResistorLevel
  };

  function getLevelScaffold(level) {
    if (!level || !level.objective) {
      return DEFAULT_SCAFFOLD;
    }
    return OBJECTIVE_SCAFFOLDS[level.objective] || DEFAULT_SCAFFOLD;
  }

  function buildGraph(components, connections, switchStates = {}) {
    const graph = {};

    components.forEach((component) => {
      (component.ports || []).forEach((port) => {
        const portId = resolvePort(component.instanceId, port.id);
        graph[portId] = graph[portId] || new Set();
      });

      getInternalConductivePairs(component, switchStates).forEach(([from, to]) => {
        connect(graph, resolvePort(component.instanceId, from), resolvePort(component.instanceId, to));
      });
    });

    connections.forEach((connection) => {
      connect(graph, connection.from, connection.to);
    });

    return { graph };
  }

  function getInternalConductivePairs(component, switchStates = {}) {
    if (component.id === "led" || component.id === "battery") {
      return [];
    }

    if (component.id === "switch") {
      const isClosed = switchStates[component.instanceId] === true;
      if (isClosed && component.ports.length >= 2) {
        return [[component.ports[0].id, component.ports[1].id]];
      }
      return [];
    }

    if ((component.ports || []).length < 2) {
      return [];
    }

    return [[component.ports[0].id, component.ports[1].id]];
  }

  function connect(graph, from, to) {
    if (!from || !to) {
      return;
    }
    graph[from] = graph[from] || new Set();
    graph[to] = graph[to] || new Set();
    graph[from].add(to);
    graph[to].add(from);
  }

  function hasPath(graph, from, to, blockedNodes = new Set()) {
    if (!graph[from] || !graph[to] || blockedNodes.has(from) || blockedNodes.has(to)) {
      return false;
    }

    const queue = [from];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === to) {
        return true;
      }

      graph[current].forEach((next) => {
        if (!visited.has(next) && !blockedNodes.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }

    return false;
  }

  function resolvePort(instanceId, portId) {
    return `${instanceId}:${portId}`;
  }

  function getComponentsById(components, id) {
    return components.filter((component) => component.id === id);
  }

  function createValidationState(level) {
    const scaffold = getLevelScaffold(level);
    return {
      level,
      scaffold,
      passItems: [],
      failItems: [],
      errorInstances: new Set(),
      errorPorts: new Set(),
      errorConnections: new Set()
    };
  }

  function addFinding(state, message) {
    if (message && !state.passItems.includes(message)) {
      state.passItems.push(message);
    }
  }

  function addIssue(state, message, markers = {}) {
    if (message && !state.failItems.includes(message)) {
      state.failItems.push(message);
    }

    (markers.instances || []).forEach((value) => {
      if (value) {
        state.errorInstances.add(value);
      }
    });

    (markers.ports || []).forEach((value) => {
      if (value) {
        state.errorPorts.add(value);
      }
    });

    (markers.connections || []).forEach((value) => {
      if (value) {
        state.errorConnections.add(value);
      }
    });
  }

  function validate(level, components, connections, switchStates = {}) {
    const state = createValidationState(level);
    const { graph } = buildGraph(components, connections, switchStates);

    if (getComponentsById(components, "battery").length === 0) {
      addIssue(state, "缺少电池，当前电路没有电源。");
    }

    (level.requiredTypes || []).forEach((requiredType) => {
      if (!components.some((component) => component.id === requiredType)) {
        addIssue(state, `缺少必选元件：${getDisplayName(requiredType)}。`);
      }
    });

    const evaluator = OBJECTIVE_VALIDATORS[level.objective];
    if (evaluator) {
      evaluator({ components, connections, graph, switchStates, state });
    }

    const passed = state.failItems.length === 0;
    return {
      passed,
      summary: passed
        ? level.successText
        : `当前电路还没有满足本关目标。${state.scaffold.startPrompt}`,
      passItems: state.passItems,
      failItems: state.failItems,
      errorInstances: Array.from(state.errorInstances),
      errorPorts: Array.from(state.errorPorts),
      errorConnections: Array.from(state.errorConnections),
      scaffold: state.scaffold
    };
  }

  function evaluateLedLoop({ components, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    if (!battery || !led) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");

    const posToAnode = hasPath(graph, batteryPositive, ledAnode);
    const cathodeToNegative = hasPath(graph, ledCathode, batteryNegative);

    if (posToAnode) {
      addFinding(state, "电池正极已经连接到 LED 正端。");
    } else {
      addIssue(state, "电池正极还没有有效连接到 LED 正端。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [batteryPositive, ledAnode]
      });
    }

    if (cathodeToNegative) {
      addFinding(state, "LED 负端已经回到电池负极。");
    } else {
      addIssue(state, "LED 负端还没有回到电池负极。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [ledCathode, batteryNegative]
      });
    }

    if (posToAnode && cathodeToNegative) {
      addFinding(state, "已经形成符合教学模型的闭合 LED 回路。");
    } else {
      addIssue(state, "电路没有形成完整闭合回路。", {
        instances: [battery.instanceId, led.instanceId]
      });
    }
  }

  function evaluateSwitchLevel({ components, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    const sw = components.find((component) => component.id === "switch");
    if (!battery || !led || !sw) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");
    const switchA = resolvePort(sw.instanceId, "a");
    const switchB = resolvePort(sw.instanceId, "b");

    const throughSwitch =
      hasPath(graph, batteryPositive, switchA) &&
      hasPath(graph, switchB, ledAnode);
    const ledBack = hasPath(graph, ledCathode, batteryNegative);
    const bypassSwitch = hasPath(graph, batteryPositive, ledAnode, new Set([switchA, switchB]));

    if (throughSwitch) {
      addFinding(state, "主路径已经经过开关并连接到 LED。");
    } else {
      addIssue(state, "开关没有真正串入主回路，请让正极到 LED 的路径经过开关。", {
        instances: [battery.instanceId, sw.instanceId, led.instanceId],
        ports: [batteryPositive, switchA, switchB, ledAnode]
      });
    }

    if (ledBack) {
      addFinding(state, "LED 负端仍能回到电池负极。");
    } else {
      addIssue(state, "LED 负端没有回到电池负极，回路不完整。", {
        instances: [battery.instanceId, led.instanceId],
        ports: [ledCathode, batteryNegative]
      });
    }

    if (!bypassSwitch && throughSwitch) {
      addFinding(state, "没有发现绕过开关的旁路连接。");
    } else if (bypassSwitch) {
      addIssue(state, "检测到正极可以绕过开关直达 LED，开关失去了控制作用。", {
        instances: [battery.instanceId, sw.instanceId, led.instanceId],
        ports: [batteryPositive, ledAnode]
      });
    }
  }

  function evaluateParallelLevel({ components, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const loads = components.filter((component) => component.id === "lamp" || component.id === "led");
    if (!battery) {
      return;
    }

    if (loads.length < 2) {
      addIssue(state, "并联关卡至少需要两个负载元件。");
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");

    let validBranches = 0;
    loads.slice(0, 2).forEach((load) => {
      const entryPort = resolvePort(load.instanceId, load.id === "led" ? "anode" : "a");
      const exitPort = resolvePort(load.instanceId, load.id === "led" ? "cathode" : "b");

      if (hasPath(graph, batteryPositive, entryPort) && hasPath(graph, exitPort, batteryNegative)) {
        validBranches += 1;
      }
    });

    const firstLoad = loads[0];
    const secondLoad = loads[1];
    const firstExit = resolvePort(firstLoad.instanceId, firstLoad.id === "led" ? "cathode" : "b");
    const secondEntry = resolvePort(secondLoad.instanceId, secondLoad.id === "led" ? "anode" : "a");
    const seriesLike =
      hasPath(graph, firstExit, secondEntry) &&
      !hasPath(graph, batteryPositive, secondEntry);

    if (validBranches === 2) {
      addFinding(state, "两个负载都形成了各自通向电源负极的独立支路。");
    } else {
      addIssue(state, "两个负载还没有都形成独立支路，当前结构不够像标准并联。", {
        instances: loads.slice(0, 2).map((item) => item.instanceId)
      });
    }

    if (!seriesLike) {
      addFinding(state, "没有检测到明显的串联首尾连接。");
    } else {
      addIssue(state, "两个负载看起来被首尾串起来了，而不是并联。", {
        instances: [firstLoad.instanceId, secondLoad.instanceId],
        ports: [firstExit, secondEntry]
      });
    }
  }

  function evaluateResistorLevel({ components, connections, graph, state }) {
    const battery = components.find((component) => component.id === "battery");
    const led = components.find((component) => component.id === "led");
    const resistor = components.find((component) => component.id === "resistor");
    if (!battery || !led || !resistor) {
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");
    const ledAnode = resolvePort(led.instanceId, "anode");
    const ledCathode = resolvePort(led.instanceId, "cathode");
    const resistorA = resolvePort(resistor.instanceId, "a");
    const resistorB = resolvePort(resistor.instanceId, "b");
    const blockedNodes = new Set([resistorA, resistorB]);

    const posToResistorA = hasPath(graph, batteryPositive, resistorA);
    const posToResistorB = hasPath(graph, batteryPositive, resistorB);
    const resistorAToLed = hasPath(graph, resistorA, ledAnode);
    const resistorBToLed = hasPath(graph, resistorB, ledAnode);

    const throughResistor =
      (posToResistorA && resistorBToLed) ||
      (posToResistorB && resistorAToLed);

    const positiveToResistor = posToResistorA || posToResistorB;
    const resistorToLed = resistorAToLed || resistorBToLed;

    const ledBack = hasPath(graph, ledCathode, batteryNegative);
    const bypassResistor = hasPath(graph, batteryPositive, ledAnode, blockedNodes);

    const resistorIsolated = !positiveToResistor && !resistorToLed;
    const resistorPartial = positiveToResistor && !resistorToLed;
    const resistorAfterLed = resistorToLed && !positiveToResistor;

    const ledPathWithoutResistor = hasPath(graph, batteryPositive, ledAnode, blockedNodes);
    const ledConnected = hasPath(graph, batteryPositive, ledAnode);

    if (throughResistor) {
      addFinding(state, "电阻已经正确串入主路径：电池正极 → 电阻 → LED 正端。");
    } else if (resistorIsolated) {
      addIssue(state, "电阻完全游离在主路径之外：电池正极既到不了电阻的任何一端，电阻也到不了 LED 正端。", {
        instances: [resistor.instanceId],
        ports: [resistorA, resistorB]
      });
    } else if (resistorPartial) {
      if (posToResistorA) {
        addIssue(state, "电池正极已经接到电阻 A 端，但电阻 B 端还没有连接到 LED 正端。电阻只串了一半。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, resistorA, resistorB, ledAnode]
        });
      } else {
        addIssue(state, "电池正极已经接到电阻 B 端，但电阻 A 端还没有连接到 LED 正端。电阻只串了一半。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, resistorB, resistorA, ledAnode]
        });
      }
    } else if (resistorAfterLed) {
      if (resistorAToLed) {
        addIssue(state, "电阻 A 端能到 LED 正端，但电池正极到不了电阻的任何一端。电阻可能被放在了 LED 之后，或者根本没接到电源侧。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, resistorA, resistorB, ledAnode]
        });
      } else {
        addIssue(state, "电阻 B 端能到 LED 正端，但电池正极到不了电阻的任何一端。电阻可能被放在了 LED 之后，或者根本没接到电源侧。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, resistorB, resistorA, ledAnode]
        });
      }
    } else if (positiveToResistor) {
      addFinding(state, "电池正极已经先接到电阻。");
    } else {
      addIssue(state, "电池正极还没有先连接到电阻的任何一端。", {
        instances: [battery.instanceId, resistor.instanceId],
        ports: [batteryPositive, resistorA, resistorB]
      });
    }

    if (ledBack) {
      addFinding(state, "LED 负端已经回到电池负极，回路下半部分是完整的。");
    } else {
      const cathodeConnected = graph[ledCathode] && graph[ledCathode].size > 0;
      if (cathodeConnected) {
        addIssue(state, "LED 负端已经有连线，但没有正确回到电池负极。请检查 LED 负端之后的路径是否能最终到达电池负极。", {
          instances: [battery.instanceId, led.instanceId],
          ports: [ledCathode, batteryNegative]
        });
      } else {
        addIssue(state, "LED 负端还没有任何连线。请将 LED 负端接回电池负极以完成回路。", {
          instances: [led.instanceId],
          ports: [ledCathode]
        });
      }
    }

    if (!bypassResistor && throughResistor) {
      addFinding(state, "没有发现绕过电阻直达 LED 的旁路，电阻真正承担了保护作用。");
    } else if (bypassResistor) {
      if (ledConnected && !throughResistor) {
        addIssue(state, "检测到电池正极可以绕过电阻直接到达 LED 正端！当前 LED 已经能被点亮，但电阻被完全跳过了，没有起到保护作用。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, ledAnode]
        });
      } else if (ledConnected && throughResistor) {
        addIssue(state, "检测到存在绕过电阻的旁路导线！虽然电阻已经串入路径，但同时存在一条不经过电阻的导线直接连接电池正极侧和 LED 正端侧，这会让电阻失去保护意义。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, ledAnode]
        });
      } else {
        addIssue(state, "检测到正极可以绕过电阻直接到 LED，电阻没有真正串入主回路。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, ledAnode]
        });
      }

      const bypassConnections = findBypassConnections(connections, graph, batteryPositive, ledAnode, blockedNodes);
      bypassConnections.forEach((connId) => {
        state.errorConnections.add(connId);
      });
    }

    if (throughResistor && ledBack && !bypassResistor) {
      addFinding(state, "电阻已经正确串入 LED 主回路，形成了完整的保护结构。");
    }
  }

  function findBypassConnections(connections, graph, batteryPositive, ledAnode, blockedNodes) {
    const bypassConnIds = [];

    connections.forEach((connection) => {
      const from = connection.from;
      const to = connection.to;

      const fromOnPositiveSide = hasPath(graph, batteryPositive, from, blockedNodes);
      const toOnPositiveSide = hasPath(graph, batteryPositive, to, blockedNodes);
      const fromOnLedSide = hasPath(graph, from, ledAnode, blockedNodes);
      const toOnLedSide = hasPath(graph, to, ledAnode, blockedNodes);

      if ((fromOnPositiveSide && toOnLedSide) || (toOnPositiveSide && fromOnLedSide)) {
        bypassConnIds.push(connection.id);
      }
    });

    return bypassConnIds;
  }

  function getDisplayName(componentId) {
    const map = {
      battery: "电池",
      led: "LED",
      switch: "开关",
      wire: "导线",
      lamp: "小灯泡",
      resistor: "电阻"
    };

    return map[componentId] || componentId;
  }

  window.CircuitValidator = {
    validate,
    getLevelScaffold
  };
})();
