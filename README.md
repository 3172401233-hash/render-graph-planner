# render-graph-planner

零依赖的 Node.js 渲染图规划库：把调用方声明的渲染 pass 与资源读写关系，编译成确定性的、可序列化的 GPU 执行计划。库本身不连接真实 GPU，也不调用 Vulkan / DirectX / WebGPU——输出的是一份纯数据计划，供自研引擎的渲染后端消费。

## 能力概览

- **声明式输入**：在 `graphics` / `compute` / `transfer` 三种队列上声明 pass，以及每个 pass 对纹理（texture）和缓冲区（buffer）的读写与布局。
- **校验**：缺失资源、同一资源被多个 pass 无序写入、transient 资源只读未写（读写依赖不清）、依赖环路、非法描述符、重复声明。所有错误都携带具体的 pass 名与资源名。
- **确定性调度**：无环输入生成稳定的拓扑序（按 pass 名字典序决胜），与 Map 遍历顺序、声明顺序无关。
- **死 pass 剔除**：不影响外部资源（imported / persistent）且无 `sideEffect` 的 pass 及其上游链会被剔除。
- **生命周期**：为每个 transient 资源计算从首次写入到最终读取的区间（以执行序下标表示）。
- **内存别名**：按类型、格式、usage、大小与队列约束判断两个 transient 能否共用存储；生命周期重叠时绝不共用；imported / persistent 资源不进入别名池；偏移满足各资源的对齐要求，并给出总内存占用。
- **屏障推导**：输出布局转换（layout-transition）与跨队列所有权转移（queue-transfer）屏障序列。

## 安装与测试

```bash
npm test   # 等价于 node --test
```

要求 Node.js >= 18，无任何第三方依赖。

## 快速上手

```js
import { RenderGraph, compile } from 'render-graph-planner';

const graph = new RenderGraph();

graph.addResource({ name: 'backbuffer', type: 'texture', format: 'rgba8', size: 8 << 20, storage: 'imported' });
graph.addResource({ name: 'sceneColor', type: 'texture', format: 'rgba16f', size: 8 << 20, usage: ['render-target', 'sampled'] });

graph.addPass({
  name: 'GBuffer',
  queue: 'graphics',
  reads: [],
  writes: [{ name: 'sceneColor', layout: 'render-target' }],
});
graph.addPass({
  name: 'Tonemap',
  queue: 'graphics',
  reads: [{ name: 'sceneColor', layout: 'shader-read' }],
  writes: [{ name: 'backbuffer', layout: 'render-target' }],
});

const result = compile(graph);
if (!result.ok) {
  for (const err of result.errors) console.error(err.code, err.message);
} else {
  console.log(JSON.stringify(result.plan, null, 2));
}
```

## 输入模型

### 资源 `addResource(desc)`

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `name` | 唯一资源名 | 必填 |
| `type` | `'texture'` \| `'buffer'` | 必填 |
| `format` | 格式字符串，如 `'rgba8'` | 必填 |
| `size` | 字节数 | 必填 |
| `usage` | 字符串或字符串数组 | `[]` |
| `storage` | `'transient'` \| `'imported'` \| `'persistent'` | `'transient'` |
| `queues` | 允许使用的队列子集 | 全部三种队列 |
| `alignment` | 对齐字节数 | `256` |

### Pass `addPass(desc)`

| 字段 | 说明 |
| --- | --- |
| `name` | 唯一 pass 名 |
| `queue` | `'graphics'` \| `'compute'` \| `'transfer'` |
| `reads` / `writes` | 资源名字符串，或 `{ name, layout }`；缺省 layout 为 `'read'` / `'write'` |
| `sideEffect` | 为 `true` 时即使不写外部资源也不会被剔除 |

## 输出计划

`compile(graph)` 返回 `{ ok: false, errors }` 或 `{ ok: true, plan }`。`plan` 可 JSON 序列化：

- `passes`：剔除死 pass 后的执行顺序（含队列与读写布局）。
- `culledPasses`：被剔除的 pass 名（字典序）。
- `lifetimes`：每个 transient 资源的 `{ name, first, last, aliasGroup, offset }`。
- `aliasGroups`：别名组 `{ id, offset, size, alignment, resources }`。
- `barriers`：屏障序列 `{ resource, beforePass, types, from, to }`。
- `totalMemory`：transient 内存池总字节数（含对齐填充）。

## 错误码

| code | 含义 |
| --- | --- |
| `missing-resource` | pass 引用了未声明的资源 |
| `parallel-write` | 同一资源被多个 pass 写入且顺序未定义 |
| `unclear-dependency` | transient 资源被读取但没有任何 pass 写入 |
| `dependency-cycle` | pass 间存在依赖环路（`cycle` 字段给出具体环） |
| `duplicate-resource` / `duplicate-pass` | 重复声明 |
| `invalid-descriptor` | 非法的队列、类型、尺寸、对齐等描述符字段 |

## 确定性保证

相同语义的输入（无论资源、pass、读写数组的声明顺序如何）必然生成逐字节相同的计划：拓扑排序以名字字典序决胜，别名分配按（尺寸降序、名字升序）处理候选，所有输出集合在序列化前排序。

## 项目结构

```
src/
  graph.js      输入模型与规范化
  validate.js   声明校验
  schedule.js   依赖建边、拓扑排序、死 pass 剔除、生命周期
  memory.js     别名兼容性判断与偏移分配
  barriers.js   布局转换与跨队列屏障推导
  compile.js    编译管线
test/           node:test 测试（钻石依赖、死 pass、并行写冲突、环路、
                生命周期重叠、跨队列、持久资源、格式差异、声明顺序变化）
```
