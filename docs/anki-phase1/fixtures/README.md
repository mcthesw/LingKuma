# 身份测试数据

`identity-v1.json` 包含14个固定输入与期望值，覆盖空白规范化、同词新语境、重复词位置、大小写、短语、NFC/NFD、emoji前缀、缺上下文来源和普通来源不参与去重。

这些数据由独立Python参考计算产生，并检查了应相同/不同的ID关系。它们不是浏览器/Anki实现通过的证明。实际JS实现必须通过这些固定期望值，不能在测试中用被测函数重新生成expected。

输入offset和期望offset都是JavaScript UTF-16索引；hash使用固定顺序JSON数组的UTF-8字节。fixture的fallbackSourceKey是适配器输出的既定值，不测试URL提取算法。
