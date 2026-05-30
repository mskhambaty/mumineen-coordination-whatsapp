# Postmark Assignment Notification Template

Create this template in Postmark with alias `assignment-notification`.

Set the env var `POSTMARK_ASSIGNMENT_TEMPLATE=assignment-notification`.

## Suggested Template (HTML)

```html
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">New {{item_type}} assigned to you</h2>
  <p>Hi {{name}},</p>
  <p>You have been assigned a new <strong>{{item_type}}</strong> in the <strong>{{department_name}}</strong> department:</p>
  <div style="background: #f4f4f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="font-size: 18px; font-weight: 600; margin: 0 0 4px;">{{item_title}}</p>
    <p style="color: #71717a; margin: 0;">Department: {{department_name}}</p>
  </div>
  <a href="{{action_url}}" style="display: inline-block; background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">View in Dashboard</a>
  <p style="color: #a1a1aa; font-size: 13px; margin-top: 32px;">{{product_name}}</p>
</body>
</html>
```

## Template Variables

| Variable | Description |
|----------|-------------|
| `name` | Recipient's display name |
| `item_type` | "milestone", "task", or "issue" |
| `item_title` | Title of the assigned item |
| `department_name` | Department the item belongs to |
| `action_url` | Link to the relevant dashboard page |
| `product_name` | "Anjuman e Saifee Chicago Portal" |
