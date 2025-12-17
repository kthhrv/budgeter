
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

Local Development
-----------------

You can run the project locally using the provided `Makefile`.

**Prerequisites:**
- `uv` (for Python dependency management)
- `npm` (for Frontend dependency management)

**Commands:**

- **Install Dependencies**:
  ```bash
  make install
  ```

- **Run Backend**:
  ```bash
  make run-backend
  ```

- **Run Frontend**:
  ```bash
  make run-frontend
  ```

- **Run Tests**:
  ```bash
  make test
  ```
