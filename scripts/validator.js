(function () {
  function buildGraph(components, connections, switchStates = {}) {
    const graph = {};
    const meta = {};

    components.forEach((component) => {
      component.ports.forEach((port) => {
        const portId = `${component.instanceId}:${port.id}`;
        graph[portId] = graph[portId] || new Set();
        meta[portId] = {
          componentId: component.id,
          instanceId: component.instanceId,
          portId: port.id,
          label: port.label
        };
      });

      const conductivePairs = getInternalConductivePairs(component, switchStates);
      conductivePairs.forEach(([from, to]) => {
        const fromId = `${component.instanceId}:${from}`;
        const toId = `${component.instanceId}:${to}`;
        connect(graph, fromId, toId);
      });
    });

    connections.forEach((connection) => {
      connect(graph, connection.from, connection.to);
    });

    return { graph, meta };
  }

  function getInternalConductivePairs(component, switchStates = {}) {
    if (component.id === "led") {
      return [];
    }

    if (component.id === "switch") {
      const isClosed = switchStates[component.instanceId] === true;
      if (isClosed && component.ports.length >= 2) {
        return [[component.ports[0].id, component.ports[1].id]];
      }
      return [];
    }

    if (component.ports.length < 2) {
      return [];
    }

    return [[component.ports[0].id, component.ports[1].id]];
  }

  function connect(graph, from, to) {
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

  function getComponentsById(components, id) {
    return components.filter((component) => component.id === id);
  }

  function resolvePort(instanceId, portId) {
    return `${instanceId}:${portId}`;
  }

  function validate(level, components, connections, switchStates = {}) {
    const requiredFindings = [];
    const issues = [];

    const { graph } = buildGraph(components, connections, switchStates);
    const batteries = getComponentsById(components, "battery");

    if (batteries.length === 0) {
      issues.push("缺少电池，当前电路没有电源。");
    }

    level.requiredTypes.forEach((requiredType) => {
      if (!components.some((component) => component.id === requiredType)) {
        issues.push(`缺少必选元件：${getDisplayName(requiredType)}。`);
      }
    });

    if (level.objective === "closed-led-loop") {
      evaluateLedLoop({ components, graph, issues, requiredFindings });
    }

    if (level.objective === "switch-controls-led") {
      evaluateSwitchLevel({ components, graph, issues, requiredFindings });
    }

    if (level.objective === "parallel-loads") {
      evaluateParallelLevel({ components, graph, issues, requiredFindings });
    }

    const passed = issues.length === 0;
    return {
      passed,
      passItems: requiredFindings,
      failItems: issues,
      summary: passed ? level.successText : "当前电路还没有满足本关目标，先根据待修正项继续调整。"
    };
  }

  function evaluateLedLoop({ components, graph, issues, requiredFindings }) {
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
    const cathodeToNeg = hasPath(graph, ledCathode, batteryNegative);
    const loopExists = posToAnode && cathodeToNeg;

    if (posToAnode) {
      requiredFindings.push("电池正极已经连到 LED 正端。");
    } else {
      issues.push("电池正极还没有有效连接到 LED 正端。");
    }

    if (cathodeToNeg) {
      requiredFindings.push("LED 负端已经回到电池负极。");
    } else {
      issues.push("LED 负端还没有回到电池负极。");
    }

    if (loopExists) {
      requiredFindings.push("已经形成符合教学模型的闭合 LED 回路。");
    } else {
      issues.push("电路没有形成完整闭合回路。");
    }
  }

  function evaluateSwitchLevel({ components, graph, issues, requiredFindings }) {
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

    const throughSwitch = hasPath(graph, batteryPositive, switchA) && hasPath(graph, switchB, ledAnode);
    const ledBack = hasPath(graph, ledCathode, batteryNegative);
    const blockedNodes = new Set([switchA, switchB]);
    const bypassSwitch = hasPath(graph, batteryPositive, ledAnode, blockedNodes);

    if (throughSwitch) {
      requiredFindings.push("主路径已经经过开关并连接到 LED。");
    } else {
      issues.push("开关没有真正串入主回路。请让正极到 LED 的路径经过开关。");
    }

    if (ledBack) {
      requiredFindings.push("LED 负端仍能回到电池负极。");
    } else {
      issues.push("LED 负端没有回到电池负极，回路不完整。");
    }

    if (!bypassSwitch && throughSwitch) {
      requiredFindings.push("没有发现绕过开关的旁路连接。");
    } else if (bypassSwitch) {
      issues.push("检测到正极可以绕过开关直达 LED，开关失去了控制作用。");
    }
  }

  function evaluateParallelLevel({ components, graph, issues, requiredFindings }) {
    const battery = components.find((component) => component.id === "battery");
    const loads = components.filter((component) => component.id === "lamp" || component.id === "led");

    if (!battery) {
      return;
    }

    if (loads.length < 2) {
      issues.push("并联关卡至少需要两个负载元件。");
      return;
    }

    const batteryPositive = resolvePort(battery.instanceId, "positive");
    const batteryNegative = resolvePort(battery.instanceId, "negative");

    let validBranches = 0;
    loads.slice(0, 2).forEach((load) => {
      const entryPort = load.id === "led" ? "anode" : "a";
      const exitPort = load.id === "led" ? "cathode" : "b";
      const entryId = resolvePort(load.instanceId, entryPort);
      const exitId = resolvePort(load.instanceId, exitPort);
      const entryPath = hasPath(graph, batteryPositive, entryId);
      const exitPath = hasPath(graph, exitId, batteryNegative);

      if (entryPath && exitPath) {
        validBranches += 1;
      }
    });

    const firstLoad = loads[0];
    const secondLoad = loads[1];
    const seriesLike =
      hasPath(
        graph,
        resolvePort(firstLoad.instanceId, firstLoad.id === "led" ? "cathode" : "b"),
        resolvePort(secondLoad.instanceId, secondLoad.id === "led" ? "anode" : "a")
      ) &&
      !hasPath(
        graph,
        batteryPositive,
        resolvePort(secondLoad.instanceId, secondLoad.id === "led" ? "anode" : "a")
      );

    if (validBranches === 2) {
      requiredFindings.push("两个负载都形成了各自通向电源负极的独立支路。");
    } else {
      issues.push("两个负载还没有都形成独立支路，当前结构不像标准并联。");
    }

    if (!seriesLike) {
      requiredFindings.push("没有检测到明显的串联首尾连接。");
    } else {
      issues.push("两个负载看起来被首尾串起来了，而不是并联。");
    }
  }

  function getDisplayName(componentId) {
    const map = {
      battery: "电池",
      led: "LED",
      switch: "开关",
      wire: "导线",
      lamp: "小灯泡"
    };

    return map[componentId] || componentId;
  }

  window.CircuitValidator = {
    validate
  };
})();

