
build
-----

```
docker build -t budgeter -f Dockerfile .
```

run
---

```
docker run -p8000:80 -v /tmp/data:/data -it budgeter
```
