from django.urls import path
from . import views

app_name = 'api'

urlpatterns = [
    path('chart-data/', views.chart_data_api, name='chart_data'),
    path('balance/', views.balance_api, name='balance'),
    path('positions/', views.positions_api, name='positions'),
]
