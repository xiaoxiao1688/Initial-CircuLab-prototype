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

  function findPath(graph, from, to, blockedNodes = new Set()) {
    if (!graph[from] || !graph[to] || blockedNodes.has(from) || blockedNodes.has(to)) {
      return null;
    }

    const queue = [[from]];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const path = queue.shift();
      const current = path[path.length - 1];

      if (current === to) {
        return path;
      }

      graph[current].forEach((next) => {
        if (!visited.has(next) && !blockedNodes.has(next)) {
          visited.add(next);
          queue.push([...path, next]);
        }
      });
    }

    return null;
  }

  function getNodeInstance(portRef) {
    if (!portRef) return null;
    const parts = portRef.split(":");
    return parts[0];
  }

  function getNodePort(portRef) {
    if (!portRef) return null;
    const parts = portRef.split(":");
    return parts[1];
  }

  function analyzePathComponents(path) {
    if (!path || path.length < 2) {
      return { components: [], ports: [] };
    }

    const components = new Set();
    const ports = new Set();

    path.forEach((portRef) => {
      const instanceId = getNodeInstance(portRef);
      const portId = getNodePort(portRef);
      if (instanceId) {
        components.add(instanceId);
      }
      if (portRef) {
        ports.add(portRef);
      }
    });

    return {
      components: Array.from(components),
      ports: Array.from(ports)
    };
  }

  function findPathThroughResistor(graph, batteryPositive, ledAnode, resistorA, resistorB) {
    const path1 = findPath(graph, batteryPositive, resistorA);
    if (path1) {
      const path2 = findPath(graph, resistorB, ledAnode);
      if (path2) {
        return {
          success: true,
          direction: "A-to-B",
          pathToResistor: path1,
          pathFromResistor: path2,
          fullPath: [...path1, ...path2.slice(1)]
        };
      }
    }

    const path3 = findPath(graph, batteryPositive, resistorB);
    if (path3) {
      const path4 = findPath(graph, resistorA, ledAnode);
      if (path4) {
        return {
          success: true,
          direction: "B-to-A",
          pathToResistor: path3,
          pathFromResistor: path4,
          fullPath: [...path3, ...path4.slice(1)]
        };
      }
    }

    return { success: false };
  }

  function findDirectPathWithoutResistor(graph, batteryPositive, ledAnode, resistorA, resistorB) {
    const blockedNodes = new Set([resistorA, resistorB]);
    return findPath(graph, batteryPositive, ledAnode, blockedNodes);
  }

  function identifyProblematicConnections(connections, graph, batteryPositive, ledAnode, resistorA, resistorB) {
    const problematic = {
      missingFromPositiveToResistor: [],
      missingFromResistorToLed: [],
      missingFromLedToNegative: [],
      bypassConnections: []
    };

    const blockedNodes = new Set([resistorA, resistorB]);

    connections.forEach((connection) => {
      const from = connection.from;
      const to = connection.to;

      const fromOnPositiveSide = hasPath(graph, batteryPositive, from, blockedNodes);
      const toOnPositiveSide = hasPath(graph, batteryPositive, to, blockedNodes);
      const fromOnLedSide = hasPath(graph, from, ledAnode, blockedNodes);
      const toOnLedSide = hasPath(graph, to, ledAnode, blockedNodes);

      if ((fromOnPositiveSide && toOnLedSide) || (toOnPositiveSide && fromOnLedSide)) {
        problematic.bypassConnections.push(connection.id);
      }
    });

    return problematic;
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

    const resistorAConnected = graph[resistorA] && graph[resistorA].size > 0;
    const resistorBConnected = graph[resistorB] && graph[resistorB].size > 0;
    const ledAnodeConnected = graph[ledAnode] && graph[ledAnode].size > 0;
    const ledCathodeConnected = graph[ledCathode] && graph[ledCathode].size > 0;

    const correctPathResult = findPathThroughResistor(graph, batteryPositive, ledAnode, resistorA, resistorB);
    const bypassPath = findDirectPathWithoutResistor(graph, batteryPositive, ledAnode, resistorA, resistorB);

    const throughResistor = correctPathResult.success;
    const bypassResistor = bypassPath !== null;

    const ledBack = hasPath(graph, ledCathode, batteryNegative);
    const ledConnected = hasPath(graph, batteryPositive, ledAnode);

    const problematic = identifyProblematicConnections(
      connections, graph, batteryPositive, ledAnode, resistorA, resistorB
    );

    if (throughResistor) {
      const pathInfo = correctPathResult.direction === "A-to-B"
        ? "电流路径：电池正极 → 电阻 A 端 → 电阻 B 端 → LED 正端"
        : "电流路径：电池正极 → 电阻 B 端 → 电阻 A 端 → LED 正端";
      addFinding(state, "电阻已经正确串入主路径：" + pathInfo);
    } else {
      const pathToA = findPath(graph, batteryPositive, resistorA);
      const pathToB = findPath(graph, batteryPositive, resistorB);
      const pathFromAToLed = findPath(graph, resistorA, ledAnode);
      const pathFromBToLed = findPath(graph, resistorB, ledAnode);

      if (!resistorAConnected && !resistorBConnected) {
        addIssue(state, "电阻完全游离：两个端口都没有任何连线。正确的连接方式是：电池正极 → 电阻一端（A 或 B）→ 电阻另一端（B 或 A）→ LED 正端。", {
          instances: [resistor.instanceId],
          ports: [resistorA, resistorB]
        });
      } else if (resistorAConnected && !resistorBConnected) {
        if (pathToA) {
          addIssue(state, "电池正极能到电阻 A 端，但电阻 B 端完全没有连线。电流只能进入电阻，无法流出到 LED。请将电阻 B 端连接到 LED 正端。", {
            instances: [resistor.instanceId, led.instanceId],
            ports: [resistorB, ledAnode]
          });
        } else if (pathFromAToLed) {
          addIssue(state, "电阻 A 端能到 LED 正端，但电池正极到不了电阻的任何一端，而且电阻 B 端没有连线。电阻被放在了错误的位置。正确顺序：电池正极 → 电阻 → LED 正端 → LED 负端 → 电池负极。", {
            instances: [battery.instanceId, resistor.instanceId, led.instanceId],
            ports: [batteryPositive, resistorB, ledAnode]
          });
        } else {
          addIssue(state, "电阻 A 端有连线但不在主路径上，电阻 B 端完全没有连线。电阻没有真正接入电路。", {
            instances: [resistor.instanceId],
            ports: [resistorA, resistorB]
          });
        }
      } else if (!resistorAConnected && resistorBConnected) {
        if (pathToB) {
          addIssue(state, "电池正极能到电阻 B 端，但电阻 A 端完全没有连线。电流只能进入电阻，无法流出到 LED。请将电阻 A 端连接到 LED 正端。", {
            instances: [resistor.instanceId, led.instanceId],
            ports: [resistorA, ledAnode]
          });
        } else if (pathFromBToLed) {
          addIssue(state, "电阻 B 端能到 LED 正端，但电池正极到不了电阻的任何一端，而且电阻 A 端没有连线。电阻被放在了错误的位置。正确顺序：电池正极 → 电阻 → LED 正端 → LED 负端 → 电池负极。", {
            instances: [battery.instanceId, resistor.instanceId, led.instanceId],
            ports: [batteryPositive, resistorA, ledAnode]
          });
        } else {
          addIssue(state, "电阻 B 端有连线但不在主路径上，电阻 A 端完全没有连线。电阻没有真正接入电路。", {
            instances: [resistor.instanceId],
            ports: [resistorA, resistorB]
          });
        }
      } else {
        if (pathToA && !pathFromBToLed) {
          const bPath = findPath(graph, resistorB, ledAnode);
          if (!bPath) {
            addIssue(state, "电池正极能到电阻 A 端，但电阻 B 端到不了 LED 正端。电阻只串了一半，电流无法从电阻流向 LED。请检查电阻 B 端到 LED 正端之间的连接。", {
              instances: [resistor.instanceId, led.instanceId],
              ports: [resistorB, ledAnode]
            });
          }
        } else if (pathToB && !pathFromAToLed) {
          const aPath = findPath(graph, resistorA, ledAnode);
          if (!aPath) {
            addIssue(state, "电池正极能到电阻 B 端，但电阻 A 端到不了 LED 正端。电阻只串了一半，电流无法从电阻流向 LED。请检查电阻 A 端到 LED 正端之间的连接。", {
              instances: [resistor.instanceId, led.instanceId],
              ports: [resistorA, ledAnode]
            });
          }
        } else if (!pathToA && !pathToB) {
          if (pathFromAToLed || pathFromBToLed) {
            addIssue(state, "电阻能到 LED 正端，但电池正极到不了电阻的任何一端。这意味着电阻被错误地放在了 LED 之后（LED 负端 → 电阻 → 电池负极），或者根本没接到电源侧。正确的顺序应该是：电池正极 → 电阻 → LED 正端 → LED 负端 → 电池负极。", {
              instances: [battery.instanceId, resistor.instanceId, led.instanceId],
              ports: [batteryPositive, resistorA, resistorB, ledAnode]
            });
          } else {
            addIssue(state, "电阻的两个端口都有连线，但都不在主路径上：电池正极既到不了电阻的任何一端，电阻也到不了 LED 正端。请检查电阻的连接方向。", {
              instances: [resistor.instanceId],
              ports: [resistorA, resistorB]
            });
          }
        }
      }
    }

    if (!ledAnodeConnected) {
      addIssue(state, "LED 正端还没有任何连线。LED 需要两个端口都正确连接：正端接电池正极侧（经过电阻），负端接电池负极侧。", {
        instances: [led.instanceId],
        ports: [ledAnode]
      });
    }

    if (ledBack) {
      addFinding(state, "LED 负端已经回到电池负极，回路下半部分是完整的。");
    } else {
      if (!ledCathodeConnected) {
        addIssue(state, "LED 负端完全没有连线。请将 LED 负端连接到电池负极以完成回路。", {
          instances: [led.instanceId, battery.instanceId],
          ports: [ledCathode, batteryNegative]
        });
      } else {
        const cathodeNeighbors = graph[ledCathode];
        let neighborOnNegativeSide = false;
        cathodeNeighbors.forEach((neighbor) => {
          if (hasPath(graph, neighbor, batteryNegative)) {
            neighborOnNegativeSide = true;
          }
        });

        if (neighborOnNegativeSide) {
          addIssue(state, "LED 负端有连线，而且邻居节点能到电池负极，但 LED 负端本身的路径有问题。请检查 LED 负端的连接是否正确。", {
            instances: [led.instanceId],
            ports: [ledCathode]
          });
        } else {
          const pathFromCathode = findPath(graph, ledCathode, batteryPositive);
          if (pathFromCathode) {
            addIssue(state, "LED 负端的连线连到了电池正极侧！这是错误的。LED 负端应该连接到电池负极侧。", {
              instances: [led.instanceId, battery.instanceId],
              ports: [ledCathode, batteryNegative]
            });
          } else {
            addIssue(state, "LED 负端有连线，但路径到不了电池负极。请检查 LED 负端 → 电池负极之间的所有连接。", {
              instances: [led.instanceId, battery.instanceId],
              ports: [ledCathode, batteryNegative]
            });
          }
        }
      }
    }

    if (!bypassResistor && throughResistor) {
      addFinding(state, "没有发现绕过电阻直达 LED 的旁路，电阻真正承担了保护作用。");
    } else if (bypassResistor) {
      const bypassConnections = problematic.bypassConnections;

      if (ledConnected && !throughResistor) {
        if (bypassConnections.length > 0) {
          const bypassPathAnalysis = analyzePathComponents(bypassPath);
          addIssue(state, "检测到电池正极可以绕过电阻直接到达 LED 正端！有 " + bypassConnections.length + " 条导线形成了旁路。当前 LED 已经能被点亮，但电阻被完全跳过了，没有起到保护作用。从仿真角度看：电流会选择电阻更小的路径，所以如果有一条导线直接连接电池正极侧和 LED 正端侧，电流就会绕过电阻。请删除或修改这些旁路导线。", {
            instances: [battery.instanceId, resistor.instanceId, led.instanceId],
            ports: [batteryPositive, ledAnode]
          });
        } else {
          addIssue(state, "检测到电池正极可以绕过电阻直接到达 LED 正端！当前 LED 已经能被点亮，但电阻被完全跳过了，没有起到保护作用。", {
            instances: [battery.instanceId, resistor.instanceId, led.instanceId],
            ports: [batteryPositive, ledAnode]
          });
        }
      } else if (ledConnected && throughResistor) {
        if (bypassConnections.length > 0) {
          addIssue(state, "检测到存在绕过电阻的旁路导线！虽然电阻已经正确串入主路径，但同时有 " + bypassConnections.length + " 条导线直接连接了电池正极侧和 LED 正端侧，形成了不经过电阻的旁路。这会让电阻失去保护意义：根据并联电路原理，电流会选择电阻更小的路径（导线的电阻几乎为 0），所以大部分电流会绕过电阻。请删除这些旁路导线。", {
            instances: [battery.instanceId, resistor.instanceId, led.instanceId],
            ports: [batteryPositive, ledAnode]
          });
        } else {
          addIssue(state, "检测到存在绕过电阻的旁路！虽然电阻已经串入路径，但同时存在不经过电阻的路径连接电池正极侧和 LED 正端侧，这会让电阻失去保护意义。", {
            instances: [battery.instanceId, resistor.instanceId, led.instanceId],
            ports: [batteryPositive, ledAnode]
          });
        }
      } else {
        addIssue(state, "检测到正极可以绕过电阻直接到 LED，电阻没有真正串入主回路。", {
          instances: [battery.instanceId, resistor.instanceId, led.instanceId],
          ports: [batteryPositive, ledAnode]
        });
      }

      bypassConnections.forEach((connId) => {
        state.errorConnections.add(connId);
      });
    }

    if (throughResistor && ledBack && !bypassResistor) {
      addFinding(state, "电阻已经正确串入 LED 主回路，形成了完整的保护结构。");
    }
  }

  function findBypassConnectionsPrecise(connections, graph, batteryPositive, ledAnode, blockedNodes) {
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
